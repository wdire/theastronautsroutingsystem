/**
 * Terrain: a height grid cut from Web Mercator DEM tiles, and the path helpers that read it.
 *
 * A grid is described by a GridSpec: sample (row r, col c) sits at world pixel
 * (px0 + c * step, py0 + r * step) of a 256 * 2^zoom pixel Web Mercator world. Row 0 is north.
 * Mercator is conformal, so a cell is square on the ground; its size shrinks with cos(latitude).
 */
import { MARS_RADIUS_M, REGION_CENTER } from '../lib/constants';
import type { Grid, LonLat, PathPoint } from './types';

export interface GridSpec {
  zoom: number;
  /** World pixel of sample (0, 0). */
  px0: number;
  py0: number;
  /** World pixels between neighbouring samples. */
  step: number;
  rows: number;
  cols: number;
  /** Row-major heights in metres, rows * cols long. */
  heights: Float32Array;
}

const DEG = Math.PI / 180;
const specs = new WeakMap<Grid, GridSpec>();

function worldPx(zoom: number): number {
  return 256 * 2 ** zoom;
}

function latOfPy(py: number, world: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) / DEG;
}

function pyOfLat(lat: number, world: number): number {
  return (world * (1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI)) / 2;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Build a Grid over the heights of a spec. The heights are used as they are, not copied. */
export function makeGrid(spec: GridSpec): Grid {
  const { zoom, px0, py0, step, rows, cols, heights } = spec;
  if (!(rows >= 1 && cols >= 1) || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new Error(`A grid needs whole, positive rows and cols (got ${rows} x ${cols}).`);
  }
  if (heights.length !== rows * cols) {
    throw new Error(`A ${rows} x ${cols} grid needs ${rows * cols} heights, got ${heights.length}.`);
  }
  if (!(step > 0)) throw new Error('A grid needs a positive step.');
  const world = worldPx(zoom);
  const mPerPxAtEquator = (2 * Math.PI * MARS_RADIUS_M) / world;

  const latOf = (row: number): number => latOfPy(py0 + row * step, world);
  const lonOf = (col: number): number => ((px0 + col * step) / world) * 360 - 180;
  const rowOf = (lat: number): number => (pyOfLat(lat, world) - py0) / step;
  const colOf = (lon: number): number => (((lon + 180) / 360) * world - px0) / step;
  const cellM = (row: number): number => step * Math.cos(latOf(row) * DEG) * mPerPxAtEquator;

  const h = (r: number, c: number): number =>
    heights[clampInt(r, 0, rows - 1) * cols + clampInt(c, 0, cols - 1)] ?? 0;

  const elevation = (lat: number, lon: number): number => {
    const r = Math.min(Math.max(rowOf(lat), 0), rows - 1);
    const c = Math.min(Math.max(colOf(lon), 0), cols - 1);
    const r0 = Math.min(Math.floor(r), Math.max(rows - 2, 0));
    const c0 = Math.min(Math.floor(c), Math.max(cols - 2, 0));
    const fr = r - r0;
    const fc = c - c0;
    const top = h(r0, c0) * (1 - fc) + h(r0, c0 + 1) * fc;
    const bottom = h(r0 + 1, c0) * (1 - fc) + h(r0 + 1, c0 + 1) * fc;
    return top * (1 - fr) + bottom * fr;
  };

  const slopeDeg = (row: number, col: number): number => {
    const size = cellM(clampInt(row, 0, rows - 1));
    const east = hornEast(h, row, col) / (8 * size);
    const south = hornSouth(h, row, col) / (8 * size);
    return Math.atan(Math.hypot(east, south)) / DEG;
  };

  const ruggedness = (row: number, col: number): number => {
    const z = h(row, col);
    let sum = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr !== 0 || dc !== 0) sum += Math.abs(h(row + dr, col + dc) - z);
      }
    }
    return sum / 8;
  };

  const crop = (r0: number, c0: number, r1: number, c1: number): Grid => {
    const a = clampInt(Math.floor(r0), 0, rows - 1);
    const b = clampInt(Math.floor(c0), 0, cols - 1);
    const a1 = clampInt(Math.ceil(r1), a + 1, rows);
    const b1 = clampInt(Math.ceil(c1), b + 1, cols);
    const out = new Float32Array((a1 - a) * (b1 - b));
    for (let r = a; r < a1; r++) {
      out.set(heights.subarray(r * cols + b, r * cols + b1), (r - a) * (b1 - b));
    }
    return makeGrid({ zoom, px0: px0 + b * step, py0: py0 + a * step, step, rows: a1 - a, cols: b1 - b, heights: out });
  };

  const grid: Grid = {
    rows,
    cols,
    west: lonOf(0),
    east: lonOf(cols - 1),
    north: latOf(0),
    south: latOf(rows - 1),
    heights,
    cellWidthM: cellM((rows - 1) / 2),
    cellM,
    latOf,
    lonOf,
    rowOf,
    colOf,
    elevation,
    slopeDeg,
    ruggedness,
    crop,
  };
  specs.set(grid, spec);
  return grid;
}

type HeightAt = (r: number, c: number) => number;

/** Horn’s weighted east-minus-west height difference; divide by 8 cells for the gradient. */
function hornEast(h: HeightAt, r: number, c: number): number {
  return (
    h(r - 1, c + 1) + 2 * h(r, c + 1) + h(r + 1, c + 1) - (h(r - 1, c - 1) + 2 * h(r, c - 1) + h(r + 1, c - 1))
  );
}

function hornSouth(h: HeightAt, r: number, c: number): number {
  return (
    h(r + 1, c - 1) + 2 * h(r + 1, c) + h(r + 1, c + 1) - (h(r - 1, c - 1) + 2 * h(r - 1, c) + h(r - 1, c + 1))
  );
}

/**
 * The spec a grid was built from, so it can be posted to a worker and rebuilt with makeGrid.
 * A Grid from elsewhere gets an equivalent spec worked out from its edges.
 */
export function gridSpecOf(grid: Grid): GridSpec {
  const known = specs.get(grid);
  if (known) return known;
  const zoom = 12;
  const world = worldPx(zoom);
  const px0 = ((grid.west + 180) / 360) * world;
  const px1 = ((grid.east + 180) / 360) * world;
  const py0 = pyOfLat(grid.north, world);
  const py1 = pyOfLat(grid.south, world);
  const step = grid.cols > 1 ? (px1 - px0) / (grid.cols - 1) : grid.rows > 1 ? (py1 - py0) / (grid.rows - 1) : 1;
  return { zoom, px0, py0, step, rows: grid.rows, cols: grid.cols, heights: grid.heights };
}

/** Horn gradients for every cell as rise over run: towards the east and towards the north. */
export function gradients(grid: Grid): { east: Float32Array; north: Float32Array } {
  const { rows, cols, heights } = grid;
  const east = new Float32Array(rows * cols);
  const north = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const rn = (r > 0 ? r - 1 : r) * cols;
    const rm = r * cols;
    const rs = (r < rows - 1 ? r + 1 : r) * cols;
    const k = 1 / (8 * grid.cellM(r));
    for (let c = 0; c < cols; c++) {
      const cw = c > 0 ? c - 1 : c;
      const ce = c < cols - 1 ? c + 1 : c;
      const nw = heights[rn + cw] ?? 0;
      const n = heights[rn + c] ?? 0;
      const ne = heights[rn + ce] ?? 0;
      const w = heights[rm + cw] ?? 0;
      const e = heights[rm + ce] ?? 0;
      const sw = heights[rs + cw] ?? 0;
      const s = heights[rs + c] ?? 0;
      const se = heights[rs + ce] ?? 0;
      east[rm + c] = (ne + 2 * e + se - (nw + 2 * w + sw)) * k;
      north[rm + c] = (nw + 2 * n + ne - (sw + 2 * s + se)) * k;
    }
  }
  return { east, north };
}

/* ---------- crop windows ---------- */

export interface GridWindow {
  r0: number;
  c0: number;
  /** Exclusive. */
  r1: number;
  c1: number;
}

/** The rows and columns that hold the points plus a margin in metres, clamped to the grid. */
export function windowAround(grid: Grid, points: readonly (LonLat | PathPoint)[], marginM: number): GridWindow {
  let rMin = Infinity;
  let rMax = -Infinity;
  let cMin = Infinity;
  let cMax = -Infinity;
  for (const p of points) {
    const r = grid.rowOf(p[1]);
    const c = grid.colOf(p[0]);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (c < cMin) cMin = c;
    if (c > cMax) cMax = c;
  }
  if (!Number.isFinite(rMin)) return { r0: 0, c0: 0, r1: grid.rows, c1: grid.cols };
  const pad = Math.ceil(Math.max(marginM, 0) / grid.cellWidthM) + 1;
  const r0 = clampInt(Math.floor(rMin) - pad, 0, grid.rows - 1);
  const c0 = clampInt(Math.floor(cMin) - pad, 0, grid.cols - 1);
  return {
    r0,
    c0,
    r1: clampInt(Math.ceil(rMax) + pad + 1, r0 + 1, grid.rows),
    c1: clampInt(Math.ceil(cMax) + pad + 1, c0 + 1, grid.cols),
  };
}

/** The part of a grid around some points: the search window for a route between them. */
export function cropAround(grid: Grid, points: readonly (LonLat | PathPoint)[], marginM: number): Grid {
  const w = windowAround(grid, points, marginM);
  return grid.crop(w.r0, w.c0, w.r1, w.c1);
}

/** A coarser grid: each new cell is the mean of a factor x factor block. */
export function decimate(grid: Grid, factor: number): Grid {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return grid;
  const spec = gridSpecOf(grid);
  const rows = Math.max(1, Math.floor(grid.rows / f));
  const cols = Math.max(1, Math.floor(grid.cols / f));
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let dr = 0; dr < f && r * f + dr < grid.rows; dr++) {
        for (let dc = 0; dc < f && c * f + dc < grid.cols; dc++) {
          sum += grid.heights[(r * f + dr) * grid.cols + c * f + dc] ?? 0;
          n++;
        }
      }
      out[r * cols + c] = n > 0 ? sum / n : 0;
    }
  }
  const shift = ((f - 1) / 2) * spec.step;
  return makeGrid({
    zoom: spec.zoom,
    px0: spec.px0 + shift,
    py0: spec.py0 + shift,
    step: spec.step * f,
    rows,
    cols,
    heights: out,
  });
}

/* ---------- synthetic grids (tests, demos) ---------- */

export interface SyntheticOptions {
  /** Where the middle of the grid sits. Defaults to the centre of the region. */
  center?: LonLat;
}

/**
 * A made-up grid with square cells of about cellM metres, heights from a function of row and column.
 * Row 0 is north, column 0 west.
 */
export function syntheticGrid(
  rows: number,
  cols: number,
  cellM: number,
  heightAt: (row: number, col: number) => number,
  options: SyntheticOptions = {},
): Grid {
  const [lon, lat] = options.center ?? REGION_CENTER;
  const zoom = 14;
  const world = worldPx(zoom);
  const step = cellM / ((Math.cos(lat * DEG) * 2 * Math.PI * MARS_RADIUS_M) / world);
  const heights = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[r * cols + c] = heightAt(r, c);
  }
  return makeGrid({
    zoom,
    px0: ((lon + 180) / 360) * world - ((cols - 1) / 2) * step,
    py0: pyOfLat(lat, world) - ((rows - 1) / 2) * step,
    step,
    rows,
    cols,
    heights,
  });
}

/** Level ground at one height. */
export function flatGrid(rows: number, cols: number, cellM: number, height = 0, options?: SyntheticOptions): Grid {
  return syntheticGrid(rows, cols, cellM, () => height, options);
}

/** A plane that rises towards the east (or the north) at a steady angle. */
export function slopedGrid(
  rows: number,
  cols: number,
  cellM: number,
  slopeDeg: number,
  rising: 'east' | 'north' = 'east',
  options?: SyntheticOptions,
): Grid {
  const rise = Math.tan(slopeDeg * DEG) * cellM;
  return syntheticGrid(rows, cols, cellM, (r, c) => (rising === 'east' ? c * rise : (rows - 1 - r) * rise), options);
}

/* ---------- paths ---------- */

/** Great-circle distance on Mars, metres. */
export function haversineM(a: LonLat | PathPoint, b: LonLat | PathPoint): number {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Length over the ground of a path, metres (heights are not counted). */
export function pathLengthM(path: readonly (LonLat | PathPoint)[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) sum += haversineM(a, b);
  }
  return sum;
}

/** Give each point its height from the grid. */
export function pathElevations(grid: Grid, points: readonly (LonLat | PathPoint)[]): PathPoint[] {
  return points.map((p) => [p[0], p[1], grid.elevation(p[1], p[0])] as const);
}

/**
 * Points every everyM metres along a path, starting at its first point and ending at its last.
 * Heights, where the path has them, are interpolated.
 */
export function resamplePath(path: readonly PathPoint[], everyM: number): PathPoint[];
export function resamplePath(path: readonly LonLat[], everyM: number): LonLat[];
export function resamplePath(path: readonly (LonLat | PathPoint)[], everyM: number): (LonLat | PathPoint)[] {
  const first = path[0];
  if (!first) return [];
  const out: (LonLat | PathPoint)[] = [first];
  if (!(everyM > 0)) return path.slice();
  let next = everyM;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const len = haversineM(a, b);
    while (len > 0 && next <= walked + len) {
      out.push(mix(a, b, (next - walked) / len));
      next += everyM;
    }
    walked += len;
  }
  const last = path[path.length - 1];
  const tail = out[out.length - 1];
  if (last && tail && path.length > 1) {
    // Drop a sample that lands on (or within a millimetre of) the end, then close on the true end.
    if (out.length > 1 && haversineM(tail, last) < 1e-3) out.pop();
    out.push(last);
  }
  return out;
}

function mix(a: LonLat | PathPoint, b: LonLat | PathPoint, t: number): LonLat | PathPoint {
  const lon = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;
  const za = a[2];
  const zb = b[2];
  return za !== undefined && zb !== undefined ? [lon, lat, za + (zb - za) * t] : [lon, lat];
}
