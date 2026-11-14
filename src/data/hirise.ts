import { decodeTerrarium } from './terrarium';
import { HIRISE_TILE, insideHirise, levelRes, lonLatToSource, tileUrlFor, type HiriseLayer } from './hiriseGrid';

const ESRI_HIRISE = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/HiRISE/MapServer/tile';
/** Degrees per pixel of Esri's global HiRISE layer at level 0; 512 px tiles from 180 W, 90 N. */
const ESRI_BASE_RES = 0.3515625;

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

/**
 * At most this many tile requests at once. A cold tile takes seconds to cut, and the browser opens only six
 * connections to the app's own server: the rest must stay free for the package tiles the view opens on.
 */
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting: { priority: number; start: () => void }[] = [];

function nextWaiting(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    // Lowest number first: the ground under the viewer before the ground a kilometre off.
    waiting.sort((a, b) => a.priority - b.priority);
    waiting.shift()?.start();
  }
}

function slot<T>(priority: number, job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({
      priority,
      start: () => {
        inFlight += 1;
        job()
          .then(resolve, reject)
          .finally(() => {
            inFlight -= 1;
            nextWaiting();
          });
      },
    });
    nextWaiting();
  });
}

async function decodeTile(url: string, signal?: AbortSignal): Promise<Tile> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const res = await fetch(url, signal ? { signal } : undefined);
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

function tile(layer: HiriseLayer | 'esri', level: number, x: number, y: number, signal?: AbortSignal, priority = 5): Promise<Tile> {
  const key = `${layer}/${level}/${x}/${y}`;
  let hit = tiles.get(key);
  if (hit) {
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  // Esri's tiles come from a CDN and do not hold up the app's own server: no queue for them.
  hit = layer === 'esri' ? decodeTile(`${ESRI_HIRISE}/${level}/${y}/${x}`, signal) : slot(priority, () => decodeTile(tileUrlFor(layer, level, x, y), signal));
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
  priority = 5,
): Promise<Omit<HiriseMosaic, 'filled'> & { tilesWithData: number; tiles: number }> {
  const [west, south, east, north] = box;
  const r = tileRange(layer, level, west, south, east, north);
  const jobs: Promise<void>[] = [];
  let tilesWithData = 0;
  const mid = lonLatToSource(layer, (west + east) / 2, (south + north) / 2);
  const span = HIRISE_TILE * 2 ** level;
  for (let ty = r.y0; ty <= r.y1; ty += 1) {
    for (let tx = r.x0; tx <= r.x1; tx += 1) {
      // The tile under the middle of the box first, then outward.
      const away = Math.hypot((tx + 0.5) * span - mid.col, (ty + 0.5) * span - mid.row) / span;
      jobs.push(
        tile(layer, level, tx, ty, signal, priority + away * 0.1).then((t) => {
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
export async function loadHiriseHeights(box: readonly [number, number, number, number], level: number, signal?: AbortSignal, priority = 5): Promise<HiriseHeights> {
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
    priority,
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
export async function loadHiriseImage(box: readonly [number, number, number, number], level: number, signal?: AbortSignal, priority = 5): Promise<HiriseImage> {
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
    priority,
  );
  const scale = 2 ** level;
  const uvOf = (lon: number, lat: number): [number, number] => {
    const s = lonLatToSource('ortho', lon, lat);
    return [(s.col / scale - m.col0) / m.width, 1 - (s.row / scale - m.row0) / m.height];
  };
  return { ...m, canvas, uvOf, filled: filledPx / (m.width * m.height) };
}

/**
 * Esri's global HiRISE layer over a box (grey, transparent where no image), on its own simple
 * cylindrical grid: level 14 is about 1.3 m a pixel. Tiled on a CDN, so it costs the app's server
 * nothing; used for the ground beyond the close patch.
 */
export async function loadEsriHiriseImage(box: readonly [number, number, number, number], level: number, signal?: AbortSignal): Promise<HiriseImage> {
  const [west, south, east, north] = box;
  const res = ESRI_BASE_RES / 2 ** level;
  const span = HIRISE_TILE * res;
  const x0 = Math.floor((west + 180) / span);
  const x1 = Math.floor((east + 180) / span);
  const y0 = Math.floor((90 - north) / span);
  const y1 = Math.floor((90 - south) / span);
  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * HIRISE_TILE;
  canvas.height = (y1 - y0 + 1) * HIRISE_TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  let filledPx = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      jobs.push(
        tile('esri', level, tx, ty, signal)
          .then((t) => {
            if (!t) return;
            for (let i = 0; i < t.data.length; i += 4) if ((t.data[i + 3] ?? 0) > 127) filledPx += 1;
            ctx.putImageData(t, (tx - x0) * HIRISE_TILE, (ty - y0) * HIRISE_TILE);
          })
          // A missing tile leaves a hole the shader fills from the orbital colour.
          .catch(() => undefined),
      );
    }
  }
  await Promise.all(jobs);
  const width = canvas.width;
  const height = canvas.height;
  const uvOf = (lon: number, lat: number): [number, number] => [((lon + 180) / res - x0 * HIRISE_TILE) / width, 1 - ((90 - lat) / res - y0 * HIRISE_TILE) / height];
  const metres = (res * Math.PI * 3_396_190) / 180;
  return { layer: 'ortho', level, col0: x0 * HIRISE_TILE, row0: y0 * HIRISE_TILE, width, height, res: metres, filled: filledPx / (width * height), canvas, uvOf };
}
