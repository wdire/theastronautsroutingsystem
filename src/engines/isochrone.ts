/**
 * Walking range over real ground: how long it takes to walk from a point to every cell around it,
 * and the lines of equal time.
 *
 * walkingField is a Dijkstra in 16 directions (the 8 neighbours and the 8 knight’s moves; with 8
 * alone the range on flat ground comes out as an octagon). Times are float64 seconds and the queue
 * is compared against those same float64 values, so no cell is skipped by rounding.
 */
import { MinHeap } from './router/core';
import type { Grid, LonLat } from './types';

const DEG = Math.PI / 180;
/** Flat-ground pace in a pressurised suit, km/h. */
export const SUIT_FLAT_KMH = 3.3;
/** Walkers do not take ground steeper than this, degrees. */
export const WALK_BLOCK_DEG = 25;

/**
 * Tobler’s hiking function scaled so flat ground is 3.3 km/h, and held to 3.3 km/h where Tobler would
 * let a gentle descent go faster: the suit sets the top pace (the same rule as vehicles.toblerKmh).
 * Grade is signed, uphill positive. 0 at 25 degrees and steeper, either way.
 */
export function suitPaceKmh(gradeDeg: number): number {
  if (!(Math.abs(gradeDeg) < WALK_BLOCK_DEG)) return 0;
  const tobler = SUIT_FLAT_KMH * Math.exp(-3.5 * Math.abs(Math.tan(gradeDeg * DEG) + 0.05) + 3.5 * 0.05);
  return Math.min(SUIT_FLAT_KMH, tobler);
}

/** The 16 moves as [dRow, dCol]: the 8 neighbours, then the knight’s moves. */
const MOVES: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
  [-2, -1],
  [-2, 1],
  [2, -1],
  [2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
];

/** Pace looked up by rise over run, so the search does not call the pace function per step. */
const TABLE_TAN_MAX = 2;
const TABLE_STEPS = 4000;

function paceTable(paceKmh: (gradeDeg: number) => number): Float64Array {
  const table = new Float64Array(TABLE_STEPS + 1);
  for (let i = 0; i <= TABLE_STEPS; i++) {
    const tan = -TABLE_TAN_MAX + (i * 2 * TABLE_TAN_MAX) / TABLE_STEPS;
    const kmh = paceKmh(Math.atan(tan) / DEG);
    table[i] = kmh > 0 ? 3.6 / kmh : Infinity; // seconds per metre
  }
  return table;
}

/**
 * Seconds to walk from (lat, lon) to every cell, row-major; Infinity where not reached. Cells further
 * than maxH hours are not searched past, though the first cells beyond the limit keep their times so
 * a contour at the limit closes cleanly.
 *
 * Each step is timed at the pace for its own grade. A step is taken in two halves through the point
 * midway (for a diagonal or knight’s move, the mean of the cells it passes between), so a wall one
 * cell thick is not stepped over.
 */
export function walkingField(
  grid: Grid,
  lat: number,
  lon: number,
  maxH: number,
  paceKmh: (gradeDeg: number) => number = suitPaceKmh,
): Float64Array {
  const { rows, cols, heights } = grid;
  const time = new Float64Array(rows * cols).fill(Infinity);
  const r0 = Math.round(grid.rowOf(lat));
  const c0 = Math.round(grid.colOf(lon));
  if (!(r0 >= 0 && c0 >= 0 && r0 < rows && c0 < cols) || !(maxH > 0)) return time;

  const table = paceTable(paceKmh);
  const scale = TABLE_STEPS / (2 * TABLE_TAN_MAX);
  const secPerM = (rise: number, run: number): number => {
    const x = (rise / run + TABLE_TAN_MAX) * scale;
    if (!(x > 0)) return table[0] as number;
    if (x >= TABLE_STEPS) return table[TABLE_STEPS] as number;
    const i = x | 0;
    const lo = table[i] as number;
    const hi = table[i + 1] as number;
    // Between two walkable grades, interpolate; next to a blocked one, take the nearer entry.
    if (lo < Infinity && hi < Infinity) return lo + (hi - lo) * (x - i);
    return x - i < 0.5 ? lo : hi;
  };

  const cellM = new Float64Array(rows);
  for (let r = 0; r < rows; r++) cellM[r] = grid.cellM(r);
  const moveLen = MOVES.map(([dr, dc]) => Math.hypot(dr, dc));

  const maxS = maxH * 3600;
  const done = new Uint8Array(rows * cols);
  const heap = new MinHeap(4096);
  const start = r0 * cols + c0;
  time[start] = 0;
  heap.push(start, 0);

  for (;;) {
    const s = heap.pop();
    if (s < 0) break;
    const t = heap.lastKey;
    // A stale entry: this cell was reached sooner by another way. Both sides are float64.
    if (done[s] || t !== (time[s] as number)) continue;
    done[s] = 1;
    if (t > maxS) continue;
    const sr = (s / cols) | 0;
    const sc = s - sr * cols;
    const hs = heights[s] as number;
    for (let m = 0; m < MOVES.length; m++) {
      const move = MOVES[m] as readonly [number, number];
      const dr = move[0];
      const dc = move[1];
      const nr = sr + dr;
      const nc = sc + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const n = nr * cols + nc;
      if (done[n]) continue;
      const hn = heights[n] as number;
      // Height midway: the two cells the step passes between (for a straight step, the mean of the ends).
      let hm: number;
      if (dr === 0 || dc === 0) {
        hm = (hs + hn) / 2;
      } else if (dr === dc || dr === -dc) {
        hm = (hs + hn + (heights[sr * cols + nc] as number) + (heights[nr * cols + sc] as number)) / 4;
      } else if (dr === 2 || dr === -2) {
        const mr = sr + dr / 2;
        hm = ((heights[mr * cols + sc] as number) + (heights[mr * cols + nc] as number)) / 2;
      } else {
        const mc = sc + dc / 2;
        hm = ((heights[sr * cols + mc] as number) + (heights[nr * cols + mc] as number)) / 2;
      }
      const half = ((moveLen[m] as number) * ((cellM[sr] as number) + (cellM[nr] as number))) / 4;
      const step = half * (secPerM(hm - hs, half) + secPerM(hn - hm, half));
      const arrive = t + step;
      if (arrive < (time[n] as number)) {
        time[n] = arrive;
        heap.push(n, arrive);
      }
    }
  }
  return time;
}

/**
 * The line where a field crosses a level, by marching squares. Rings are closed (first point repeated
 * at the end): where the reached ground runs to the edge of the grid the ring follows the edge.
 * Cells never reached count as beyond the level.
 */
export function contour(grid: Grid, field: Float64Array, levelS: number): LonLat[][] {
  const { rows, cols } = grid;
  if (field.length !== rows * cols) throw new Error('The field does not match the grid.');

  // Values with a border of "not reached" all round, so every line closes.
  const val = (r: number, c: number): number =>
    r < 0 || c < 0 || r >= rows || c >= cols ? Infinity : (field[r * cols + c] as number);
  const inside = (r: number, c: number): boolean => val(r, c) <= levelS;

  /** Where the level is crossed between two neighbouring samples, as fractional [row, col]. */
  const cross = (ra: number, ca: number, rb: number, cb: number): [number, number] => {
    const aOut = ra < 0 || ca < 0 || ra >= rows || ca >= cols;
    const bOut = rb < 0 || cb < 0 || rb >= rows || cb >= cols;
    if (aOut) return [rb, cb];
    if (bOut) return [ra, ca];
    const a = val(ra, ca);
    const b = val(rb, cb);
    let t = 0.5;
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) t = Math.min(1, Math.max(0, (levelS - a) / (b - a)));
    return [ra + (rb - ra) * t, ca + (cb - ca) * t];
  };

  // Squares are indexed by their top-left sample, from -1 so the border is covered. An edge is named
  // by a whole number: horizontal edges (between a sample and the one to its east) and vertical edges
  // (between a sample and the one to its south) on a (rows + 2) x (cols + 2) lattice.
  const W = cols + 2;
  const H = rows + 2;
  const hEdge = (r: number, c: number): number => (r + 1) * W + (c + 1);
  const vEdge = (r: number, c: number): number => W * H + (r + 1) * W + (c + 1);
  const points = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };

  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const tl = inside(r, c);
      const tr = inside(r, c + 1);
      const br = inside(r + 1, c + 1);
      const bl = inside(r + 1, c);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = hEdge(r, c);
      const bottom = hEdge(r + 1, c);
      const left = vEdge(r, c);
      const right = vEdge(r, c + 1);
      if (tl !== tr && !points.has(top)) points.set(top, cross(r, c, r, c + 1));
      if (bl !== br && !points.has(bottom)) points.set(bottom, cross(r + 1, c, r + 1, c + 1));
      if (tl !== bl && !points.has(left)) points.set(left, cross(r, c, r + 1, c));
      if (tr !== br && !points.has(right)) points.set(right, cross(r, c + 1, r + 1, c + 1));
      switch (code) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(top, left);
          break;
        case 5:
        case 10: {
          // A saddle: two opposite corners inside. Join them if the middle is inside too.
          const vals = [val(r, c), val(r, c + 1), val(r + 1, c + 1), val(r + 1, c)];
          const mid = vals.every(Number.isFinite) ? vals.reduce((x, y) => x + y, 0) / 4 <= levelS : false;
          const trInside = code === 5; // code 5: tr and bl inside; code 10: tl and br inside
          if (trInside === mid) {
            link(top, left);
            link(bottom, right);
          } else {
            link(top, right);
            link(left, bottom);
          }
          break;
        }
      }
    }
  }

  // Walk the links into rings. Every edge point has exactly two links, so every line closes.
  const rings: LonLat[][] = [];
  const used = new Set<number>();
  for (const first of points.keys()) {
    if (used.has(first)) continue;
    const ring: LonLat[] = [];
    let prev = -1;
    let at = first;
    for (;;) {
      used.add(at);
      const p = points.get(at) as [number, number];
      ring.push([grid.lonOf(p[1]), grid.latOf(p[0])]);
      const next = (links.get(at) ?? []).find((e) => e !== prev && !used.has(e));
      if (next === undefined) break;
      prev = at;
      at = next;
    }
    const head = ring[0];
    if (head && ring.length >= 3) {
      ring.push(head);
      rings.push(ring);
    }
  }
  return rings;
}
