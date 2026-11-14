import { getCoverage, loadCoverage, nearestTile, tileUrl, type Coverage, type TileRef } from '@/data/coverage';
import { flatTile, MARS_FLAT, type TileData } from './index';

/** Decoded package tiles kept for upsampling, most recently used last. */
const bitmapCache = new Map<string, Promise<ImageBitmap>>();
const BITMAP_CACHE_MAX = 96;

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

/** A package tile as a bitmap, cached. Not tied to one request's abort signal, since others may share it. */
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

/** Draws the ancestor's window over the whole tile, smoothed. */
export async function upsample(cov: Coverage, ref: TileRef, z: number, x: number, y: number): Promise<OffscreenCanvas> {
  const bitmap = await packageBitmap(cov, ref);
  const { sx, sy, size } = ancestorWindow(ref, z, x, y);
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Half a source pixel of margin keeps the smoothing from pulling in the neighbour's edge.
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, 256, 256);
  return canvas;
}

export async function imgTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return flatTile(MARS_FLAT);
  const ref = nearestTile(cov, ['img', 'planetImg'], z, x, y);
  if (!ref) return flatTile(MARS_FLAT);
  if (ref.z === z) return fetchBytes(tileUrl(cov, ref), signal);
  return (await upsample(cov, ref, z, x, y)).transferToImageBitmap();
}
