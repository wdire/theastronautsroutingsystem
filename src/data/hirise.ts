import { decodeTerrarium } from './terrarium';
import { HIRISE_TILE, insideHirise, levelRes, lonLatToSource, tileUrlFor, type HiriseLayer } from './hiriseGrid';

/**
 * The HiRISE mosaics of Jezero, streamed tile by tile from /api/hirise, which cuts them from USGS.
 * A mosaic is a rectangle of whole tiles at one level; pixels outside the image are empty.
 */

export interface HiriseMosaic {
  layer: HiriseLayer;
  level: number;
  /** Top-left of the mosaic in level pixels. */
  col0: number;
  row0: number;
  width: number;
  height: number;
  /** Metres per pixel. */
  res: number;
  /** Share of the pixels that hold data, 0 to 1. */
  filled: number;
}

export interface HiriseHeights extends HiriseMosaic {
  /** Metres above the areoid; NaN where there is no model. */
  heights: Float32Array;
  /** Height at a point by bilinear blending, or null outside the model. */
  heightAt(lon: number, lat: number): number | null;
}

export interface HiriseImage extends HiriseMosaic {
  /** Grey in R, G and B; alpha 0 where there is no image. */
  canvas: HTMLCanvasElement;
  /** Texture coordinates (0 to 1, v up as three.js reads canvases) of a point. */
  uvOf(lon: number, lat: number): [number, number];
}

type Tile = ImageData | null;
const tiles = new Map<string, Promise<Tile>>();
const TILES_MAX = 96;

async function fetchTile(layer: HiriseLayer, level: number, x: number, y: number, signal?: AbortSignal): Promise<Tile> {
  const res = await fetch(tileUrlFor(layer, level, x, y), signal ? { signal } : undefined);
  if (res.status === 204) return null;
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`HiRISE tile answered ${res.status}`);
  // The bytes are heights for the elevation model: no colour management, no premultiplied alpha.
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(HIRISE_TILE, HIRISE_TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, HIRISE_TILE, HIRISE_TILE);
}

function tile(layer: HiriseLayer, level: number, x: number, y: number, signal?: AbortSignal): Promise<Tile> {
  const key = `${layer}/${level}/${x}/${y}`;
  let hit = tiles.get(key);
  if (hit) {
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  hit = fetchTile(layer, level, x, y, signal);
  // A failure is forgotten, so the next view asks again.
  hit.catch(() => tiles.delete(key));
  tiles.set(key, hit);
  if (tiles.size > TILES_MAX) tiles.delete(tiles.keys().next().value ?? '');
  return hit;
}

/** The tiles covering a lon/lat box at a level, as a rectangle of tile indices. */
function tileRange(layer: HiriseLayer, level: number, west: number, south: number, east: number, north: number) {
  const scale = 2 ** level;
  const a = lonLatToSource(layer, west, north);
  const b = lonLatToSource(layer, east, south);
  const span = HIRISE_TILE * scale;
  return {
    x0: Math.max(0, Math.floor(a.col / span)),
    y0: Math.max(0, Math.floor(a.row / span)),
    x1: Math.max(0, Math.floor(b.col / span)),
    y1: Math.max(0, Math.floor(b.row / span)),
  };
}

/** Whether any of the box lies on the mosaic. */
export function boxTouchesHirise(west: number, south: number, east: number, north: number): boolean {
  return insideHirise((west + east) / 2, (south + north) / 2) || insideHirise(west, south) || insideHirise(east, north) || insideHirise(west, north) || insideHirise(east, south);
}

async function mosaic(
  layer: HiriseLayer,
  level: number,
  box: readonly [number, number, number, number],
  each: (tile: ImageData, dx: number, dy: number) => void,
  signal?: AbortSignal,
): Promise<Omit<HiriseMosaic, 'filled'> & { tilesWithData: number; tiles: number }> {
  const [west, south, east, north] = box;
  const r = tileRange(layer, level, west, south, east, north);
  const jobs: Promise<void>[] = [];
  let tilesWithData = 0;
  for (let ty = r.y0; ty <= r.y1; ty += 1) {
    for (let tx = r.x0; tx <= r.x1; tx += 1) {
      jobs.push(
        tile(layer, level, tx, ty, signal).then((t) => {
          if (!t) return;
          tilesWithData += 1;
          each(t, (tx - r.x0) * HIRISE_TILE, (ty - r.y0) * HIRISE_TILE);
        }),
      );
    }
  }
  await Promise.all(jobs);
  return {
    layer,
    level,
    col0: r.x0 * HIRISE_TILE,
    row0: r.y0 * HIRISE_TILE,
    width: (r.x1 - r.x0 + 1) * HIRISE_TILE,
    height: (r.y1 - r.y0 + 1) * HIRISE_TILE,
    res: levelRes(layer, level),
    tilesWithData,
    tiles: (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1),
  };
}

/** The elevation model over a box at a level (0 is 1 m, each level doubles it). */
export async function loadHiriseHeights(box: readonly [number, number, number, number], level: number, signal?: AbortSignal): Promise<HiriseHeights> {
  const r = tileRange('dtm', level, box[0], box[1], box[2], box[3]);
  const width = (r.x1 - r.x0 + 1) * HIRISE_TILE;
  const height = (r.y1 - r.y0 + 1) * HIRISE_TILE;
  const heights = new Float32Array(width * height).fill(Number.NaN);
  const decoded = new Float32Array(HIRISE_TILE * HIRISE_TILE);
  let filled = 0;
  const m = await mosaic(
    'dtm',
    level,
    box,
    (t, dx, dy) => {
      decodeTerrarium(t.data, decoded);
      for (let y = 0; y < HIRISE_TILE; y += 1) {
        for (let x = 0; x < HIRISE_TILE; x += 1) {
          const i = y * HIRISE_TILE + x;
          if ((t.data[i * 4 + 3] ?? 0) < 128) continue;
          heights[(dy + y) * width + dx + x] = decoded[i] ?? Number.NaN;
          filled += 1;
        }
      }
    },
    signal,
  );
  const scale = 2 ** level;
  const heightAt = (lon: number, lat: number): number | null => {
    const s = lonLatToSource('dtm', lon, lat);
    // Samples sit at pixel centres.
    const fx = s.col / scale - m.col0 - 0.5;
    const fy = s.row / scale - m.row0 - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) return null;
    const tx = fx - x0;
    const ty = fy - y0;
    const a = heights[y0 * width + x0] ?? Number.NaN;
    const b = heights[y0 * width + x0 + 1] ?? Number.NaN;
    const c = heights[(y0 + 1) * width + x0] ?? Number.NaN;
    const d = heights[(y0 + 1) * width + x0 + 1] ?? Number.NaN;
    const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    return Number.isFinite(v) ? v : null;
  };
  return { ...m, heights, heightAt, filled: filled / (width * height) };
}

/** The 25 cm image over a box at a level (0 is 25 cm, each level doubles it), as a canvas. */
export async function loadHiriseImage(box: readonly [number, number, number, number], level: number, signal?: AbortSignal): Promise<HiriseImage> {
  const r = tileRange('ortho', level, box[0], box[1], box[2], box[3]);
  const canvas = document.createElement('canvas');
  canvas.width = (r.x1 - r.x0 + 1) * HIRISE_TILE;
  canvas.height = (r.y1 - r.y0 + 1) * HIRISE_TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  let filledPx = 0;
  const m = await mosaic(
    'ortho',
    level,
    box,
    (t, dx, dy) => {
      // The tile is grey and alpha; spread the grey to RGB so the canvas reads as a picture.
      const rgba = new ImageData(HIRISE_TILE, HIRISE_TILE);
      for (let i = 0; i < HIRISE_TILE * HIRISE_TILE; i += 1) {
        const g = t.data[i * 4] ?? 0;
        const a = t.data[i * 4 + 3] ?? 0;
        rgba.data[i * 4] = g;
        rgba.data[i * 4 + 1] = g;
        rgba.data[i * 4 + 2] = g;
        rgba.data[i * 4 + 3] = a;
        if (a > 127) filledPx += 1;
      }
      ctx.putImageData(rgba, dx, dy);
    },
    signal,
  );
  const scale = 2 ** level;
  const uvOf = (lon: number, lat: number): [number, number] => {
    const s = lonLatToSource('ortho', lon, lat);
    return [(s.col / scale - m.col0) / m.width, 1 - (s.row / scale - m.row0) / m.height];
  };
  return { ...m, canvas, uvOf, filled: filledPx / (m.width * m.height) };
}
