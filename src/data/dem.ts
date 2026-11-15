import type { Box } from '@/lib/constants';
import { latToPx, lonToPx, metresPerPixel } from '@/lib/geo';
import type { GridSpec } from '@/engines/terrain';
import { getCoverage, loadCoverage, nearestTile, tileUrl, type Coverage, type TileRef } from './coverage';
import { decodeTerrarium, gridZoomFor, tileWindow, upsampleHeights, TILE } from './terrarium';

/** The deepest zoom the elevation package reaches anywhere (the HiRISE model). */
export const DEM_MAX_ZOOM = 14;
const TERRAIN_PRODUCTS = ['terrain', 'planetTerrain'] as const;

/** Decoded tiles, most recently used last. 256 KB each, and every tile worker keeps its own. */
const cache = new Map<string, Promise<Float32Array>>();
/** The same tiles once resolved, for the pointer readout, which cannot wait. */
const ready = new Map<string, Float32Array>();
const CACHE_MAX = 64;

function remember(key: string, value: Promise<Float32Array>): Promise<Float32Array> {
  cache.set(key, value);
  value.then(
    (heights) => ready.set(key, heights),
    () => cache.delete(key),
  );
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      ready.delete(oldest);
    }
  }
  return value;
}

async function decodeTile(url: string): Promise<Float32Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
        lastError = new Error(`${url} answered ${res.status}`);
        continue;
      }
      // No colour management and no alpha premultiplication: the bytes are numbers, not colours.
      const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(TILE, TILE);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0, TILE, TILE);
      bitmap.close();
      return decodeTerrarium(ctx.getImageData(0, 0, TILE, TILE).data);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function packageHeights(cov: Coverage, ref: TileRef): Promise<Float32Array> {
  const key = `${ref.product}/${ref.z}/${ref.x}/${ref.y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  return remember(key, decodeTile(tileUrl(cov, ref)));
}

/**
 * Heights of any tile: the package tile if it exists, else its nearest ancestor blended up to this zoom.
 * `exact` says which. Rejects only if the package has nothing at all there, or the network fails.
 */
export async function tileHeights(z: number, x: number, y: number): Promise<{ heights: Float32Array; exact: boolean; sourceZoom: number }> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) throw new Error('The elevation package has not loaded.');
  const ref = nearestTile(cov, TERRAIN_PRODUCTS, z, x, y);
  if (!ref) throw new Error(`No elevation for tile ${z}/${x}/${y}.`);
  const src = await packageHeights(cov, ref);
  if (ref.z === z) return { heights: src, exact: true, sourceZoom: z };
  const dz = z - ref.z;
  return { heights: upsampleHeights(src, dz, x - (ref.x << dz), y - (ref.y << dz)), exact: false, sourceZoom: ref.z };
}

/** The zoom of the finest elevation the package holds at a point. */
export function finestZoomAt(cov: Coverage, lon: number, lat: number): number {
  const x = Math.floor(lonToPx(lon, DEM_MAX_ZOOM) / TILE);
  const y = Math.floor(latToPx(lat, DEM_MAX_ZOOM) / TILE);
  return nearestTile(cov, TERRAIN_PRODUCTS, DEM_MAX_ZOOM, x, y)?.z ?? 0;
}

export interface LoadedGrid {
  spec: GridSpec;
  /** Ground size of one cell at the middle of the box, m. */
  cellM: number;
  /** The zoom of the coarsest source data that went into it. */
  coarsestSourceZoom: number;
}

/**
 * A height grid over a box, at the finest zoom that keeps it under `maxCells`
 * and no finer than the data the package has at the box’s centre.
 */
export async function loadGrid(box: Box, maxCells = 1_500_000, finest?: number): Promise<LoadedGrid> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) throw new Error('The elevation package has not loaded.');
  const cLon = (box[0] + box[2]) / 2;
  const cLat = (box[1] + box[3]) / 2;
  const dataZoom = Math.max(6, finestZoomAt(cov, cLon, cLat));
  const zoom = gridZoomFor(box, maxCells, Math.min(finest ?? DEM_MAX_ZOOM, dataZoom));
  const win = tileWindow(box, zoom);
  const heights = new Float32Array(win.rows * win.cols);
  let coarsest = zoom;

  const jobs: Promise<void>[] = [];
  for (let ty = win.y0; ty <= win.y1; ty += 1) {
    for (let tx = win.x0; tx <= win.x1; tx += 1) {
      jobs.push(
        tileHeights(zoom, tx, ty).then((tile) => {
          coarsest = Math.min(coarsest, tile.sourceZoom);
          // Copy the part of this tile that falls inside the window, row by row.
          const offX = (tx - win.x0) * TILE - win.left;
          const offY = (ty - win.y0) * TILE - win.top;
          const c0 = Math.max(0, offX);
          const c1 = Math.min(win.cols, offX + TILE);
          const r0 = Math.max(0, offY);
          const r1 = Math.min(win.rows, offY + TILE);
          for (let r = r0; r < r1; r += 1) {
            const srcStart = (r - offY) * TILE + (c0 - offX);
            heights.set(tile.heights.subarray(srcStart, srcStart + (c1 - c0)), r * win.cols + c0);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);

  return {
    spec: {
      zoom,
      // Samples sit at pixel centres.
      px0: win.x0 * TILE + win.left + 0.5,
      py0: win.y0 * TILE + win.top + 0.5,
      step: 1,
      rows: win.rows,
      cols: win.cols,
      heights,
    },
    cellM: metresPerPixel(cLat, zoom),
    coarsestSourceZoom: coarsest,
  };
}

export interface GroundSample {
  elev: number;
  slopeDeg: number;
  /** The zoom of the tile it was read from. */
  zoom: number;
}

function sampleFrom(heights: Float32Array, z: number, x: number, y: number, lon: number, lat: number): GroundSample {
  const fx = lonToPx(lon, z) - x * TILE - 0.5;
  const fy = latToPx(lat, z) - y * TILE - 0.5;
  const cx = Math.max(1, Math.min(TILE - 2, Math.round(fx)));
  const cy = Math.max(1, Math.min(TILE - 2, Math.round(fy)));
  const at = (ix: number, iy: number) => heights[iy * TILE + ix] ?? 0;
  const x0 = Math.max(0, Math.min(TILE - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(TILE - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const elev =
    (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  const cell = metresPerPixel(lat, z);
  const dzdx = (at(cx + 1, cy) - at(cx - 1, cy)) / (2 * cell);
  const dzdy = (at(cx, cy + 1) - at(cx, cy - 1)) / (2 * cell);
  return { elev, slopeDeg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI, zoom: z };
}

/**
 * Ground height and slope at a point from tiles already in memory, finest first; null if none is.
 * Asks for the tile at `wantZoom` in the background so the next call can answer better.
 */
export function groundAtCached(lon: number, lat: number, wantZoom: number): GroundSample | null {
  const cov = getCoverage();
  if (!cov) return null;
  const z = Math.max(0, Math.min(DEM_MAX_ZOOM, Math.floor(wantZoom)));
  const x = Math.floor(lonToPx(lon, z) / TILE);
  const y = Math.floor(latToPx(lat, z) / TILE);
  const ref = nearestTile(cov, TERRAIN_PRODUCTS, z, x, y);
  if (!ref) return null;
  const heights = ready.get(`${ref.product}/${ref.z}/${ref.x}/${ref.y}`);
  if (heights) return sampleFrom(heights, ref.z, ref.x, ref.y, lon, lat);
  void packageHeights(cov, ref).catch(() => undefined);
  // Fall back to any coarser ancestor that is already decoded.
  for (let az = ref.z - 1; az >= 0; az -= 1) {
    const up = nearestTile(cov, TERRAIN_PRODUCTS, az, ref.x >> (ref.z - az), ref.y >> (ref.z - az));
    if (!up) break;
    const h = ready.get(`${up.product}/${up.z}/${up.x}/${up.y}`);
    if (h) return sampleFrom(h, up.z, up.x, up.y, lon, lat);
    az = up.z;
  }
  return null;
}

/** Ground height and slope at a point from the finest data the package has there. */
export async function groundAt(lon: number, lat: number, maxZoom = DEM_MAX_ZOOM): Promise<GroundSample> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) throw new Error('The elevation package has not loaded.');
  const z = Math.min(maxZoom, DEM_MAX_ZOOM);
  const x = Math.floor(lonToPx(lon, z) / TILE);
  const y = Math.floor(latToPx(lat, z) / TILE);
  const ref = nearestTile(cov, TERRAIN_PRODUCTS, z, x, y);
  if (!ref) throw new Error('No elevation here.');
  return sampleFrom(await packageHeights(cov, ref), ref.z, ref.x, ref.y, lon, lat);
}
