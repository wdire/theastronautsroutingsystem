import type { Box } from '@/lib/constants';
import { latToPx, lonToPx } from '@/lib/geo';

/** Terrarium elevation tiles: height = R * 256 + G + B / 256 - 32768, in metres. Pure helpers. */
export const TILE = 256;

export function decodeTerrarium(rgba: Uint8ClampedArray | Uint8Array, out = new Float32Array(rgba.length / 4)): Float32Array {
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = (rgba[p] ?? 0) * 256 + (rgba[p + 1] ?? 0) + (rgba[p + 2] ?? 0) / 256 - 32768;
  }
  return out;
}

export function encodeTerrarium(heights: Float32Array, out = new Uint8ClampedArray(heights.length * 4)): Uint8ClampedArray {
  for (let i = 0, p = 0; i < heights.length; i += 1, p += 4) {
    const v = Math.max(0, Math.min(65535.996, (heights[i] ?? 0) + 32768));
    const whole = Math.floor(v);
    out[p] = whole >> 8;
    out[p + 1] = whole & 255;
    out[p + 2] = Math.floor((v - whole) * 256);
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Heights for a descendant tile, read out of an ancestor tile's heights by bilinear blending.
 * `dz` is how many zoom levels below the ancestor the tile sits; (dx, dy) its position inside it.
 * Samples sit at pixel centres, so the blend is taken between the ancestor's centres, clamped at its edge.
 */
export function upsampleHeights(src: Float32Array, dz: number, dx: number, dy: number, out = new Float32Array(TILE * TILE)): Float32Array {
  const scale = 1 / 2 ** dz;
  const ox = dx * TILE * scale;
  const oy = dy * TILE * scale;
  const max = TILE - 1;
  for (let y = 0; y < TILE; y += 1) {
    const sy = Math.max(0, Math.min(max, oy + (y + 0.5) * scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(max, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < TILE; x += 1) {
      const sx = Math.max(0, Math.min(max, ox + (x + 0.5) * scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(max, x0 + 1);
      const fx = sx - x0;
      const a = src[y0 * TILE + x0] ?? 0;
      const b = src[y0 * TILE + x1] ?? 0;
      const c = src[y1 * TILE + x0] ?? 0;
      const d = src[y1 * TILE + x1] ?? 0;
      out[y * TILE + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

export interface TileWindow {
  zoom: number;
  /** Tile range, both ends included. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Pixel window inside that tile range: the grid's first sample and its size. */
  left: number;
  top: number;
  cols: number;
  rows: number;
}

/** The pixels of a zoom level that cover a box, as a window over whole tiles. */
export function tileWindow(box: Box, zoom: number): TileWindow {
  const pxW = Math.floor(lonToPx(box[0], zoom));
  const pxE = Math.ceil(lonToPx(box[2], zoom));
  const pxN = Math.floor(latToPx(box[3], zoom));
  const pxS = Math.ceil(latToPx(box[1], zoom));
  const x0 = Math.floor(pxW / TILE);
  const y0 = Math.floor(pxN / TILE);
  const x1 = Math.floor(Math.max(pxW, pxE - 1) / TILE);
  const y1 = Math.floor(Math.max(pxN, pxS - 1) / TILE);
  return { zoom, x0, y0, x1, y1, left: pxW - x0 * TILE, top: pxN - y0 * TILE, cols: Math.max(1, pxE - pxW), rows: Math.max(1, pxS - pxN) };
}

/**
 * The finest zoom, no finer than `finest`, at which the box holds at most `maxCells` samples.
 * Never coarser than `coarsest`.
 */
export function gridZoomFor(box: Box, maxCells: number, finest: number, coarsest = 6): number {
  for (let z = finest; z > coarsest; z -= 1) {
    const w = tileWindow(box, z);
    if (w.cols * w.rows <= maxCells) return z;
  }
  return coarsest;
}
