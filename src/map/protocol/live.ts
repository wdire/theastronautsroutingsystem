import { pxToLat, pxToLon } from '@/lib/geo';
import { HIRISE_LAYERS, HIRISE_TILE, sourceToLonLat, tileUrlFor } from '@/data/hiriseGrid';

/**
 * Live imagery from NASA and USGS services that publish equirectangular tiles. Tiles are fetched,
 * stitched and warped to Web Mercator on a CPU canvas, one map tile (plus padding) at a time.
 */
export interface EquirectSource {
  id: string;
  tileSize: number;
  /** Degrees per pixel at level 0. */
  baseRes: number;
  maxLevel: number;
  /** The source level whose pixels are at least as fine as a Mercator tile at zoom z. */
  levelFor(z: number): number;
  url(level: number, row: number, col: number): string;
  /** The corner of the source grid, when it is not the whole planet from 180 W, 90 N. */
  origin?: { lon: number; lat: number };
  /** Tiles across and down at a level, when the grid is not the whole planet. */
  size?: (level: number) => { cols: number; rows: number };
  /** How long to wait for a tile, ms. */
  timeoutMs?: number;
}

const ESRI = 'https://astro.arcgis.com/arcgis/rest/services/OnMars';
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';

/** MRO CTX global mosaic, about 5 m per pixel (Esri OnMars). */
export const CTX: EquirectSource = {
  id: 'ctx',
  tileSize: 512,
  baseRes: 0.3515625,
  maxLevel: 15,
  levelFor: (z) => z - 2,
  url: (l, r, c) => `${ESRI}/CTX/MapServer/tile/${l}/${r}/${c}`,
};

/** MRO HiRISE, a sparse mosaic of 25 to 50 cm images (Esri OnMars). Transparent where no image exists. */
export const HIRISE: EquirectSource = {
  id: 'hirise',
  tileSize: 512,
  baseRes: 0.3515625,
  maxLevel: 17,
  levelFor: (z) => z - 2,
  url: (l, r, c) => `${ESRI}/HiRISE/MapServer/tile/${l}/${r}/${c}`,
};

const ORTHO = HIRISE_LAYERS.ortho;
const ORTHO_LEVELS = ORTHO.maxLevel;
const [ORTHO_LON0, ORTHO_LAT0] = sourceToLonLat('ortho', 0, 0);
/** Degrees per source pixel at the coarsest level served. */
const ORTHO_COARSEST = (ORTHO.res * 2 ** ORTHO_LEVELS * 180) / (Math.PI * 3_396_190);

/**
 * The Mars 2020 HiRISE mosaic of Jezero at 25 cm (USGS), cut into tiles by /api/hirise. Levels count
 * up toward the finest here, as for the other sources; /api/hirise counts the other way.
 */
export const USGS_HIRISE: EquirectSource = {
  id: 'usgs-hirise',
  tileSize: HIRISE_TILE,
  baseRes: ORTHO_COARSEST,
  maxLevel: ORTHO_LEVELS,
  // The finest level no coarser than a map pixel's width.
  levelFor: (z) => Math.max(0, Math.min(ORTHO_LEVELS, Math.ceil(Math.log2(ORTHO_COARSEST / (360 / (256 * 2 ** z)))))),
  url: (l, r, c) => tileUrlFor('ortho', ORTHO_LEVELS - l, c, r),
  origin: { lon: ORTHO_LON0, lat: ORTHO_LAT0 },
  size: (l) => {
    const span = HIRISE_TILE * 2 ** (ORTHO_LEVELS - l);
    return { cols: Math.ceil(ORTHO.width / span), rows: Math.ceil(ORTHO.height / span) };
  },
  timeoutMs: 45_000,
};

/** Viking MDIM 2.1 colour mosaic, 232 m per pixel (NASA Mars Trek). */
export const VIKING: EquirectSource = {
  id: 'viking',
  tileSize: 256,
  baseRes: 0.703125,
  maxLevel: 7,
  levelFor: (z) => z - 1,
  url: (l, r, c) => `${TREK}/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${l}/${r}/${c}.jpg`,
};

const tileCache = new Map<string, Promise<ImageBitmap | null>>();
const TILE_CACHE_MAX = 80;
const MAX_PARALLEL = 8;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** One source tile, or null if the service has none there or does not answer in time. Never rejects. */
function sourceTile(src: EquirectSource, level: number, row: number, col: number, timeoutMs: number): Promise<ImageBitmap | null> {
  const url = src.url(level, row, col);
  const hit = tileCache.get(url);
  if (hit) {
    tileCache.delete(url);
    tileCache.set(url, hit);
    return hit;
  }
  const made = withSlot(async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: abort.signal, mode: 'cors' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      return await createImageBitmap(await res.blob());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  // A miss is not kept: the service may answer next time.
  void made.then((bitmap) => {
    if (!bitmap) tileCache.delete(url);
  });
  tileCache.set(url, made);
  if (tileCache.size > TILE_CACHE_MAX) {
    const oldest = tileCache.keys().next().value;
    if (oldest !== undefined) tileCache.delete(oldest);
  }
  return made;
}

export interface Warped {
  /** RGBA, (256 + 2 * pad) squared. Alpha is 0 where the source had nothing. */
  rgba: Uint8ClampedArray;
  size: number;
  /** Share of the padded tile the source covered, 0 to 1. */
  coverage: number;
}

/**
 * The part of a source that covers map tile (z, x, y) plus `pad` pixels on every side, in Web Mercator.
 * Null if the source has no level for this zoom or nothing came back.
 */
export async function warpToTile(src: EquirectSource, z: number, x: number, y: number, pad: number, timeoutMs = 15000): Promise<Warped | null> {
  const level = Math.min(src.maxLevel, src.levelFor(z));
  if (level < 0) return null;
  const size = 256 + 2 * pad;
  const res = src.baseRes / 2 ** level;
  const ts = src.tileSize;
  const grid = src.size?.(level) ?? { cols: Math.round(360 / (res * ts)), rows: Math.round(180 / (res * ts)) };
  const levelCols = grid.cols;
  const levelRows = grid.rows;
  const lon0 = src.origin?.lon ?? -180;
  const lat0 = src.origin?.lat ?? 90;

  // Source pixel coordinates of every output column and row. Longitude is linear, latitude is not.
  const sx = new Float64Array(size);
  const sy = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    sx[i] = (pxToLon(x * 256 - pad + i + 0.5, z) - lon0) / res - 0.5;
    sy[i] = (lat0 - pxToLat(y * 256 - pad + i + 0.5, z)) / res - 0.5;
  }
  const col0 = Math.max(0, Math.floor((sx[0] ?? 0) / ts));
  const col1 = Math.min(levelCols - 1, Math.floor(((sx[size - 1] ?? 0) + 1) / ts));
  const row0 = Math.max(0, Math.floor((sy[0] ?? 0) / ts));
  const row1 = Math.min(levelRows - 1, Math.floor(((sy[size - 1] ?? 0) + 1) / ts));
  if (col1 < col0 || row1 < row0 || (col1 - col0 + 1) * (row1 - row0 + 1) > 16) return null;

  const jobs: Promise<{ bitmap: ImageBitmap | null; r: number; c: number }>[] = [];
  for (let r = row0; r <= row1; r += 1) {
    for (let c = col0; c <= col1; c += 1) jobs.push(sourceTile(src, level, r, c, src.timeoutMs ?? timeoutMs).then((bitmap) => ({ bitmap, r, c })));
  }
  const tiles = await Promise.all(jobs);
  if (tiles.every((t) => !t.bitmap)) return null;

  const mw = (col1 - col0 + 1) * ts;
  const mh = (row1 - row0 + 1) * ts;
  const mosaic = new OffscreenCanvas(mw, mh);
  const ctx = mosaic.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  for (const t of tiles) if (t.bitmap) ctx.drawImage(t.bitmap, (t.c - col0) * ts, (t.r - row0) * ts, ts, ts);
  const srcPx = ctx.getImageData(0, 0, mw, mh).data;

  const rgba = new Uint8ClampedArray(size * size * 4);
  const ox = col0 * ts;
  const oy = row0 * ts;
  let covered = 0;
  for (let j = 0; j < size; j += 1) {
    const fy = Math.max(0, Math.min(mh - 1.001, (sy[j] ?? 0) - oy));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let i = 0; i < size; i += 1) {
      const fx = Math.max(0, Math.min(mw - 1.001, (sx[i] ?? 0) - ox));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = (y0 * mw + x0) * 4;
      const b = a + 4;
      const c = a + mw * 4;
      const d = c + 4;
      const wa = (1 - tx) * (1 - ty);
      const wb = tx * (1 - ty);
      const wc = (1 - tx) * ty;
      const wd = tx * ty;
      const o = (j * size + i) * 4;
      const alpha = (srcPx[a + 3] ?? 0) * wa + (srcPx[b + 3] ?? 0) * wb + (srcPx[c + 3] ?? 0) * wc + (srcPx[d + 3] ?? 0) * wd;
      rgba[o] = (srcPx[a] ?? 0) * wa + (srcPx[b] ?? 0) * wb + (srcPx[c] ?? 0) * wc + (srcPx[d] ?? 0) * wd;
      rgba[o + 1] = (srcPx[a + 1] ?? 0) * wa + (srcPx[b + 1] ?? 0) * wb + (srcPx[c + 1] ?? 0) * wc + (srcPx[d + 1] ?? 0) * wd;
      rgba[o + 2] = (srcPx[a + 2] ?? 0) * wa + (srcPx[b + 2] ?? 0) * wb + (srcPx[c + 2] ?? 0) * wc + (srcPx[d + 2] ?? 0) * wd;
      rgba[o + 3] = alpha;
      if (alpha > 8) covered += 1;
    }
  }
  return { rgba, size, coverage: covered / (size * size) };
}
