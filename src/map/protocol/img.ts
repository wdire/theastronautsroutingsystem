import { getCoverage, loadCoverage, nearestTile, tileUrl, type Coverage, type TileRef } from '@/data/coverage';
import { flatTile, MARS_FLAT, type TileData } from './common';
import { blendDetail, highPassRadius, luminance, type DetailLayer } from './detail';
import { CTX, HIRISE, THEMIS_DAY, USGS_HIRISE, VIKING, warpToTile, type EquirectSource, type Gaps } from './live';
import { insideHirise } from '@/data/hiriseGrid';
import { pxToLat, pxToLon } from '@/lib/geo';

/** Decoded package tiles kept for upsampling, most recently used last. */
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
const BITMAP_CACHE_MAX = 24;

/** Zoom from which each live source adds detail, and the zoom whose detail it already matches. */
const VIKING_FROM = 5;
const CTX_FROM = 9;
/** THEMIS (100 m) fills the CTX mosaic's gaps up to this zoom; closer in its pixels would only blur. */
const THEMIS_FILL_TO = 13;
const HIRISE_FROM = 14;
/** A package tile at this zoom or deeper already holds everything the source could add. */
const VIKING_NATIVE = 7;
const CTX_NATIVE = 13;

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let lastError: unknown;
  // One retry: a single dropped connection should not blank a tile.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return await res.arrayBuffer();
      lastError = new Error(`${url} answered ${res.status}`);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** A package tile as a bitmap, cached. Not tied to one request’s abort signal, since others may share it. */
export function packageBitmap(cov: Coverage, ref: TileRef): Promise<ImageBitmap> {
  const url = tileUrl(cov, ref);
  const hit = bitmapCache.get(url);
  if (hit) {
    bitmapCache.delete(url);
    bitmapCache.set(url, hit);
    return hit;
  }
  const made = fetchBytes(url, new AbortController().signal).then((bytes) => createImageBitmap(new Blob([bytes])));
  made.catch(() => bitmapCache.delete(url));
  bitmapCache.set(url, made);
  if (bitmapCache.size > BITMAP_CACHE_MAX) {
    const oldest = bitmapCache.keys().next().value;
    if (oldest !== undefined) bitmapCache.delete(oldest);
  }
  return made;
}

/** The part of an ancestor tile that covers tile (z, x, y), as source pixels. */
export function ancestorWindow(ref: TileRef, z: number, x: number, y: number): { sx: number; sy: number; size: number } {
  const dz = z - ref.z;
  const size = 256 / 2 ** dz;
  return { sx: (x - (ref.x << dz)) * size, sy: (y - (ref.y << dz)) * size, size };
}

/** Draws the ancestor’s window over the whole tile, smoothed. */
async function upsample(cov: Coverage, ref: TileRef, z: number, x: number, y: number): Promise<OffscreenCanvas> {
  const bitmap = await packageBitmap(cov, ref);
  const { sx, sy, size } = ancestorWindow(ref, z, x, y);
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, 256, 256);
  return canvas;
}

async function detailLayer(
  src: EquirectSource,
  z: number,
  x: number,
  y: number,
  pad: number,
  radius: number,
  gain: number,
  masked: boolean,
  signal?: AbortSignal,
  gaps?: Gaps,
): Promise<DetailLayer | null> {
  const warped = await warpToTile(src, z, x, y, pad, 15000, signal, gaps);
  if (!warped || warped.coverage < 0.02) return null;
  const layer: DetailLayer = { lum: luminance(warped.rgba), radius, gain };
  if (masked || warped.coverage < 0.999) {
    const mask = new Float32Array(warped.size * warped.size);
    for (let i = 0; i < mask.length; i += 1) mask[i] = (warped.rgba[i * 4 + 3] ?? 0) / 255;
    layer.mask = mask;
  }
  return layer;
}

/** Whether any corner or the middle of a map tile lies on the Jezero HiRISE mosaic. */
export function tileTouchesHirise(z: number, x: number, y: number): boolean {
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) {
    if (insideHirise(pxToLon((x + fx) * 256, z), pxToLat((y + fy) * 256, z))) return true;
  }
  return false;
}

interface DetailPlan {
  src: EquirectSource;
  radius: number;
  gain: number;
  masked: boolean;
}

/**
 * The live sources that add detail to a tile upsampled from a package tile at `refZ`: Viking below zoom 9,
 * CTX from 9, and HiRISE on top from 14 wherever an image covers the tile. Empty when the package tile is
 * already as fine as they are.
 */
function detailPlan(z: number, refZ: number): DetailPlan[] {
  if (refZ === z) return [];
  const plan: DetailPlan[] = [];
  if (z >= CTX_FROM && refZ < CTX_NATIVE) {
    plan.push({ src: CTX, radius: highPassRadius(z, refZ), gain: 1, masked: false });
  } else if (z >= VIKING_FROM && z < CTX_FROM && refZ < VIKING_NATIVE) {
    plan.push({ src: VIKING, radius: highPassRadius(z, refZ), gain: 0.9, masked: false });
  }
  if (z >= HIRISE_FROM) {
    // Esri's tiled HiRISE layer: served from a CDN, so the map never waits on the slower USGS cut.
    plan.push({ src: HIRISE, radius: highPassRadius(z, Math.max(refZ, CTX_NATIVE)), gain: 1.25, masked: true });
  }
  return plan;
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Whether the full tile waits on a live service. Such a tile can be stood in for at once by
 * `packageImage`, and swapped for the full one when the service answers.
 */
export async function liveDetailWanted(z: number, x: number, y: number): Promise<boolean> {
  if (offline()) return false;
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return false;
  const ref = nearestTile(cov, ['img', 'planetImg'], z, x, y);
  return ref !== null && detailPlan(z, ref.z).length > 0;
}

/**
 * What the shipped package alone gives for a tile, with no live service asked: the package tile, or its
 * nearest ancestor upsampled. Blurry far past the package's zoom, but always the right colours in the right
 * places, and as fast as the app's own files.
 */
export async function packageImage(z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return flatTile(MARS_FLAT);
  const ref = nearestTile(cov, ['img', 'planetImg'], z, x, y);
  if (!ref) return flatTile(MARS_FLAT);
  if (ref.z === z) return fetchBytes(tileUrl(cov, ref), signal);
  return (await upsample(cov, ref, z, x, y)).transferToImageBitmap();
}

/**
 * Base imagery for any tile to zoom 19. The package tile if there is one; otherwise the nearest
 * package ancestor, upsampled for colour, with live detail blended into its brightness (see detailPlan).
 * With no connection the upsampled ancestor is returned as it is, so there is always ground. `gaps` says
 * whether a live source failed on the way, so the tile is not finished and is worth making again.
 */
export async function imgTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal, gaps?: Gaps): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return flatTile(MARS_FLAT);
  const ref = nearestTile(cov, ['img', 'planetImg'], z, x, y);
  if (!ref) return flatTile(MARS_FLAT);
  if (ref.z === z) return fetchBytes(tileUrl(cov, ref), signal);

  const canvas = await upsample(cov, ref, z, x, y);
  const plan = detailPlan(z, ref.z);
  if (plan.length === 0 || offline()) return canvas.transferToImageBitmap();
  const pad = 32;
  const made = await Promise.all(plan.map((p) => detailLayer(p.src, z, x, y, pad, p.radius, p.gain, p.masked, signal, gaps)));
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  const layers = made.filter((l): l is DetailLayer => l !== null);
  // The CTX mosaic has gaps between its image strips; there the coarser THEMIS daytime mosaic gives the ground
  // its texture, so a strip of bare upsampled colour does not look like a tile that failed to load.
  const ctxAt = plan.findIndex((p) => p.src === CTX);
  if (ctxAt >= 0 && z <= THEMIS_FILL_TO) {
    const ctx = made[ctxAt] ?? null;
    if (!ctx || ctx.mask) {
      const fill = await detailLayer(THEMIS_DAY, z, x, y, pad, Math.min(highPassRadius(z, ref.z), 24), 0.85, true, signal, gaps);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (fill) {
        const own = fill.mask;
        const gap = ctx?.mask;
        const mask = new Float32Array(fill.lum.length);
        for (let i = 0; i < mask.length; i += 1) mask[i] = (own ? (own[i] ?? 0) : 1) * (gap ? 1 - (gap[i] ?? 0) : 1);
        fill.mask = mask;
        layers.unshift(fill);
      }
    }
  }
  if (layers.length === 0) return canvas.transferToImageBitmap();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas.transferToImageBitmap();
  const image = ctx.getImageData(0, 0, 256, 256);
  blendDetail(image.data, 256, pad, layers);
  ctx.putImageData(image, 0, 0);
  return canvas.transferToImageBitmap();
}

/** A fully transparent tile: no HD imagery here, the base shows through. A new one each time: the map may close it. */
export function transparentTile(): Promise<ImageBitmap> {
  // From pixels, not a blank canvas: a worker refuses to make a bitmap of a canvas that was never drawn on.
  return createImageBitmap(new ImageData(1, 1));
}

/**
 * The 25 cm Mars 2020 HiRISE mosaic of Jezero (USGS) over the base imagery, as a layer of its own from zoom
 * 15: the base tile draws at once, and this one fades in over it when the slower USGS cut arrives. Its colour
 * is the base tile's, its detail HiRISE's at full gain; transparent off the mosaic.
 */
export async function hdTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal, gaps?: Gaps): Promise<TileData> {
  if (!tileTouchesHirise(z, x, y)) return transparentTile();
  // A wide margin, for the wide blur below: tiles must agree at their edges.
  const pad = 64;
  // The colour comes from the package alone: this layer's own detail replaces whatever finer grain the base
  // tile carries, and the tile never waits on the base's live services as well as its own.
  const [baseData, warped] = await Promise.all([packageImage(z, x, y, signal), warpToTile(USGS_HIRISE, z, x, y, pad, 45_000, signal, gaps)]);
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  if (!warped || warped.coverage < 0.02) return transparentTile();
  const base = baseData instanceof ArrayBuffer ? await createImageBitmap(new Blob([baseData])) : baseData;
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return transparentTile();
  ctx.drawImage(base, 0, 0, 256, 256);
  const image = ctx.getImageData(0, 0, 256, 256);
  const full = warped.size;
  const mask = new Float32Array(full * full);
  for (let i = 0; i < mask.length; i += 1) mask[i] = (warped.rgba[i * 4 + 3] ?? 0) / 255;
  // Wide radius, wider the closer in: the HiRISE image carries nearly all the light and shade, from single rocks
  // to whole outcrops; the base, upsampled from 20 m, only its colour.
  blendDetail(image.data, 256, pad, [{ lum: luminance(warped.rgba), radius: z >= 17 ? 60 : z >= 16 ? 44 : 30, gain: 1.45, mask }]);
  // Off the mosaic the layer is clear, with a soft edge where the mosaic ends.
  for (let yy = 0; yy < 256; yy += 1) {
    for (let xx = 0; xx < 256; xx += 1) {
      image.data[(yy * 256 + xx) * 4 + 3] = Math.round(255 * Math.min(1, (mask[(yy + pad) * full + (xx + pad)] ?? 0) * 1.4));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.transferToImageBitmap();
}
