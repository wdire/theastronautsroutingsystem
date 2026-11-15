import { getCoverage, loadCoverage, nearestTile, tileUrl, type Coverage, type TileRef } from '@/data/coverage';
import { flatTile, MARS_FLAT, type TileData } from './index';
import { blendDetail, highPassRadius, luminance, type DetailLayer } from './detail';
import { CTX, HIRISE, USGS_HIRISE, VIKING, warpToTile, type EquirectSource } from './live';
import { insideHirise } from '@/data/hiriseGrid';
import { pxToLat, pxToLon } from '@/lib/geo';

/** Decoded package tiles kept for upsampling, most recently used last. */
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
const BITMAP_CACHE_MAX = 96;

/** Zoom from which each live source adds detail, and the zoom whose detail it already matches. */
const VIKING_FROM = 5;
const CTX_FROM = 9;
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
): Promise<DetailLayer | null> {
  const warped = await warpToTile(src, z, x, y, pad, 15000, signal);
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

/**
 * Base imagery for any tile to zoom 19. The package tile if there is one; otherwise the nearest
 * package ancestor, upsampled for colour, with live detail blended into its brightness:
 * Viking below zoom 9, CTX from 9, and HiRISE on top from 14 wherever an image covers the tile.
 * With no connection the upsampled ancestor is returned as it is, so there is always ground.
 */
export async function imgTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return flatTile(MARS_FLAT);
  const ref = nearestTile(cov, ['img', 'planetImg'], z, x, y);
  if (!ref) return flatTile(MARS_FLAT);
  if (ref.z === z) return fetchBytes(tileUrl(cov, ref), signal);

  const canvas = await upsample(cov, ref, z, x, y);
  const wanted: Promise<DetailLayer | null>[] = [];
  const pad = 32;
  if (z >= CTX_FROM && ref.z < CTX_NATIVE) {
    wanted.push(detailLayer(CTX, z, x, y, pad, highPassRadius(z, ref.z), 1, false, signal));
  } else if (z >= VIKING_FROM && z < CTX_FROM && ref.z < VIKING_NATIVE) {
    wanted.push(detailLayer(VIKING, z, x, y, pad, highPassRadius(z, ref.z), 0.9, false, signal));
  }
  if (z >= HIRISE_FROM) {
    // Esri's tiled HiRISE layer: served from a CDN, so the map never waits on the slower USGS cut.
    wanted.push(detailLayer(HIRISE, z, x, y, pad, highPassRadius(z, Math.max(ref.z, CTX_NATIVE)), 1.25, true, signal));
  }
  if (wanted.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return canvas.transferToImageBitmap();

  const layers = (await Promise.all(wanted)).filter((l): l is DetailLayer => l !== null);
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  if (layers.length === 0) return canvas.transferToImageBitmap();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas.transferToImageBitmap();
  const image = ctx.getImageData(0, 0, 256, 256);
  blendDetail(image.data, 256, pad, layers);
  ctx.putImageData(image, 0, 0);
  return canvas.transferToImageBitmap();
}

/** A fully transparent tile: no HD imagery here, the base shows through. A new one each time: the map may close it. */
function transparentTile(): Promise<ImageBitmap> {
  return createImageBitmap(new OffscreenCanvas(1, 1));
}

/**
 * The 25 cm Mars 2020 HiRISE mosaic of Jezero (USGS) over the base imagery, as a layer of its own from zoom
 * 15: the base tile draws at once, and this one fades in over it when the slower USGS cut arrives. Its colour
 * is the base tile's, its detail HiRISE's at full gain; transparent off the mosaic.
 */
export async function hdTile(rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  if (!tileTouchesHirise(z, x, y)) return transparentTile();
  // A wide margin, for the wide blur below: tiles must agree at their edges.
  const pad = 64;
  const [baseData, warped] = await Promise.all([imgTile(rest, z, x, y, signal), warpToTile(USGS_HIRISE, z, x, y, pad, 45_000, signal)]);
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
