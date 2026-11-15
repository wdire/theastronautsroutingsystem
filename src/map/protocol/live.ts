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
  /** The request pool it shares with other sources on the same server; its own id if absent. */
  pool?: string;
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
  pool: 'esri',
};

/**
 * MRO HiRISE, a sparse mosaic of 25 to 50 cm images (Esri OnMars). Transparent where no image exists. Read no
 * finer than level 16 (32 cm a pixel): level 17 only resamples the same images, at four times the tiles.
 */
export const HIRISE: EquirectSource = {
  id: 'hirise',
  tileSize: 512,
  baseRes: 0.3515625,
  maxLevel: 16,
  levelFor: (z) => z - 2,
  url: (l, r, c) => `${ESRI}/HiRISE/MapServer/tile/${l}/${r}/${c}`,
  pool: 'esri',
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

/**
 * Decoded source tiles, most recently used last, kept to a budget in bytes: a 512 px tile is a megabyte
 * decoded, and every tile worker keeps its own. Evicted tiles come back from the browser's HTTP cache (every
 * source here is served cacheable), so the budget only has to hold what the tiles being made right now share.
 */
const tileCache = new Map<string, { made: Promise<ImageBitmap | null>; bytes: number }>();
const TILE_CACHE_BYTES = 12 * 1024 * 1024;
let tileCacheBytes = 0;

function rememberTile(url: string, made: Promise<ImageBitmap | null>, bytes: number): void {
  const old = tileCache.get(url);
  if (old) tileCacheBytes -= old.bytes;
  tileCache.delete(url);
  tileCache.set(url, { made, bytes });
  tileCacheBytes += bytes;
  // Evicted bitmaps are not closed: a warp may be about to draw one it was handed a moment ago.
  for (const [key, entry] of tileCache) {
    if (tileCacheBytes <= TILE_CACHE_BYTES || tileCache.size <= 1) break;
    tileCache.delete(key);
    tileCacheBytes -= entry.bytes;
  }
}

function forgetTile(url: string, made: Promise<ImageBitmap | null>): void {
  const entry = tileCache.get(url);
  if (entry?.made !== made) return;
  tileCache.delete(url);
  tileCacheBytes -= entry.bytes;
}

/**
 * Requests wait in a pool per source, so a slow one (the USGS cut takes seconds a tile) never holds up a fast
 * one. The newest request goes first: the map asks for the view it shows now, and what it asked for on the way
 * there is stale. A request nobody waits for any more (the map moved on and aborted every tile that wanted it)
 * is dropped before it starts.
 */
interface Job {
  url: string;
  start: () => void;
  wanted: number;
  dropped: boolean;
  drop: () => void;
  /** When it was asked for, in batches: requests a few frames apart belong to the same view. */
  batch: number;
}
const BATCH_MS = 120;
const HTTP2 = typeof location !== 'undefined' && location.protocol === 'https:';
/**
 * Requests at once per pool. Esri's server speaks HTTP/1.1, so the browser opens six connections to it in all,
 * shared by every tile worker: a few each keeps the newest-first order meaningful. The USGS cut comes from the
 * app's own server, which in development is HTTP/1.1 too, and its slow answers must leave connections free
 * for the package tiles; over HTTP/2 in production that limit is gone.
 */
const POOL_SIZE: Record<string, number> = { 'usgs-hirise': HTTP2 ? 6 : 2, esri: 3 };
const pools = new Map<string, { running: number; queue: Job[] }>();

function pool(id: string) {
  let p = pools.get(id);
  if (!p) {
    p = { running: 0, queue: [] };
    pools.set(id, p);
  }
  return p;
}

function pump(id: string): void {
  const p = pool(id);
  const max = POOL_SIZE[id] ?? 8;
  while (p.running < max) {
    const job = nextJob(p.queue);
    if (!job) return;
    if (job.dropped) continue;
    job.start();
  }
}

/**
 * The newest view's requests first, and within one view the order they were asked in: the map asks for the
 * tiles nearest the middle of the screen first, so plain newest-first would fetch the edges before the centre.
 */
function nextJob(queue: Job[]): Job | undefined {
  let best = -1;
  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i]!;
    if (best < 0 || job.batch > queue[best]!.batch) best = i;
  }
  return best < 0 ? undefined : queue.splice(best, 1)[0];
}

/** One source tile, or null if the service has none there, does not answer in time, or nobody wants it any more. Never rejects. */
function sourceTile(src: EquirectSource, level: number, row: number, col: number, timeoutMs: number, signal?: AbortSignal): Promise<ImageBitmap | null> {
  const url = src.url(level, row, col);
  const hit = tileCache.get(url);
  if (hit) {
    tileCache.delete(url);
    tileCache.set(url, hit);
    const job = jobs.get(url);
    if (job) want(job, signal);
    return hit.made;
  }
  const poolId = src.pool ?? src.id;
  const p = pool(poolId);
  let job!: Job;
  const made = new Promise<ImageBitmap | null>((resolve) => {
    job = {
      url,
      batch: Math.floor(performance.now() / BATCH_MS),
      wanted: 0,
      dropped: false,
      drop: () => {
        job.dropped = true;
        resolve(null);
      },
      start: () => {
        p.running += 1;
        jobs.delete(url);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        void fetch(url, { signal: abort.signal, mode: 'cors' })
          .then(async (res) => (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/') ? createImageBitmap(await res.blob()) : null))
          .catch(() => null)
          .then((bitmap) => {
            clearTimeout(timer);
            p.running -= 1;
            resolve(bitmap);
            pump(poolId);
          });
      },
    };
  });
  jobs.set(url, job);
  want(job, signal);
  p.queue.push(job);
  pump(poolId);
  // A miss (or a dropped request) is not kept: the service may answer next time.
  void made.then((bitmap) => {
    if (!bitmap) forgetTile(url, made);
  });
  rememberTile(url, made, src.tileSize * src.tileSize * 4);
  return made;
}

/** Jobs not yet started, by URL, so a second asker can count itself in. */
const jobs = new Map<string, Job>();

function want(job: Job, signal?: AbortSignal): void {
  // A request with no signal (prefetch, overlays) is always wanted.
  if (!signal) {
    job.wanted = Number.POSITIVE_INFINITY;
    return;
  }
  if (signal.aborted) return;
  job.wanted += 1;
  signal.addEventListener(
    'abort',
    () => {
      job.wanted -= 1;
      if (job.wanted <= 0 && !job.dropped && jobs.get(job.url) === job) {
        jobs.delete(job.url);
        job.drop();
      }
    },
    { once: true },
  );
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
export async function warpToTile(src: EquirectSource, z: number, x: number, y: number, pad: number, timeoutMs = 15000, signal?: AbortSignal): Promise<Warped | null> {
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

  const work: Promise<{ bitmap: ImageBitmap | null; r: number; c: number }>[] = [];
  for (let r = row0; r <= row1; r += 1) {
    for (let c = col0; c <= col1; c += 1) work.push(sourceTile(src, level, r, c, src.timeoutMs ?? timeoutMs, signal).then((bitmap) => ({ bitmap, r, c })));
  }
  const tiles = await Promise.all(work);
  if (tiles.every((t) => !t.bitmap)) return null;

  // Only the source pixels under the tile are read back: close in, a tile spans a sliver of one source tile, and
  // reading all of every source tile it touches cost many times the warp itself.
  const ox0 = col0 * ts;
  const oy0 = row0 * ts;
  const fullW = (col1 - col0 + 1) * ts;
  const fullH = (row1 - row0 + 1) * ts;
  const bx0 = Math.max(0, Math.floor(Math.min(sx[0] ?? 0, sx[size - 1] ?? 0) - ox0) - 1);
  const by0 = Math.max(0, Math.floor(Math.min(sy[0] ?? 0, sy[size - 1] ?? 0) - oy0) - 1);
  const bx1 = Math.min(fullW, Math.ceil(Math.max(sx[0] ?? 0, sx[size - 1] ?? 0) - ox0) + 2);
  const by1 = Math.min(fullH, Math.ceil(Math.max(sy[0] ?? 0, sy[size - 1] ?? 0) - oy0) + 2);
  const mw = Math.max(2, bx1 - bx0);
  const mh = Math.max(2, by1 - by0);
  const mosaic = new OffscreenCanvas(mw, mh);
  const ctx = mosaic.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  for (const t of tiles) if (t.bitmap) ctx.drawImage(t.bitmap, (t.c - col0) * ts - bx0, (t.r - row0) * ts - by0, ts, ts);
  const srcPx = ctx.getImageData(0, 0, mw, mh).data;

  const rgba = new Uint8ClampedArray(size * size * 4);
  const ox = ox0 + bx0;
  const oy = oy0 + by0;
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
