/**
 * The route search: Lazy Theta* (any-angle A*) over a height grid, and the wrapper that turns a
 * RouteRequest into a RouteReply with typed failures. Pure: no DOM, no clock, no randomness, so the
 * same request on the same grid always gives the same route.
 *
 * Costs are seconds. A CostField says what a second of travel weighs on each cell and in each
 * direction; router/cost.ts builds one from a vehicle and a style. Times are kept in Float64Arrays and
 * queue entries are compared against those same float64 values, so no cell is skipped by rounding.
 */
import { REGION, inBox } from '../../lib/constants';
import type { Grid, HazardZone, LonLat, PathPoint, RouteReply, RouteRequest } from '../types';

/* ---------- priority queue ---------- */

/** A binary min-heap of (id, key) pairs with float64 keys. Stale entries are the caller's to skip. */
export class MinHeap {
  private keys: Float64Array;
  private ids: Int32Array;
  private n = 0;
  /** The key of the entry returned by the last pop(). */
  lastKey = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.ids = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  push(id: number, key: number): void {
    if (this.n === this.keys.length) {
      const keys = new Float64Array(this.n * 2);
      keys.set(this.keys);
      this.keys = keys;
      const ids = new Int32Array(this.n * 2);
      ids.set(this.ids);
      this.ids = ids;
    }
    const keys = this.keys;
    const ids = this.ids;
    let i = this.n++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pk = keys[parent] as number;
      if (pk <= key) break;
      keys[i] = pk;
      ids[i] = ids[parent] as number;
      i = parent;
    }
    keys[i] = key;
    ids[i] = id;
  }

  /** Removes and returns the id with the smallest key, or -1 when empty. */
  pop(): number {
    if (this.n === 0) return -1;
    const keys = this.keys;
    const ids = this.ids;
    const top = ids[0] as number;
    this.lastKey = keys[0] as number;
    const n = --this.n;
    if (n > 0) {
      const key = keys[n] as number;
      const id = ids[n] as number;
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
        const ck = keys[child] as number;
        if (ck >= key) break;
        keys[i] = ck;
        ids[i] = ids[child] as number;
        i = child;
      }
      keys[i] = key;
      ids[i] = id;
    }
    return top;
  }
}

/* ---------- cost field ---------- */

/** Why a vehicle cannot start or stop on a cell. */
export type EndBlock = { kind: 'steep'; slopeDeg: number } | { kind: 'hazard'; hazard: HazardZone['kind'] };

/** Words for failure messages, e.g. "the rover", "can climb", "drivable spot". */
export interface CostWords {
  vehicle: string;
  climb: string;
  spot: string;
}

export interface CostField {
  rows: number;
  cols: number;
  /** Cell size in metres for each row. */
  cellMByRow: Float64Array;
  /** 1 where the vehicle may not pass. */
  blocked: Uint8Array;
  /** What a second weighs on each cell (1 or more), or null for 1 everywhere. */
  mult: Float32Array | null;
  /** Ground gradient as rise over run towards the east and the north; null for level ground or flight. */
  gradE: Float32Array | null;
  gradN: Float32Array | null;
  /**
   * Seconds per metre by the slope along the way of travel: entry i is for a rise over run of
   * -paceTanMax + i * 2 * paceTanMax / (length - 1). Infinity where the vehicle cannot go.
   */
  pace: Float64Array;
  paceTanMax: number;
  /** A lower bound on seconds per metre anywhere on the grid: it drives the search heuristic. */
  minSecPerM: number;
  /**
   * For costs that count the work of climbing (energy), a second lower bound that knows the heights:
   * getting from a to b costs at least perM * distance + perRiseM * (height of b - height of a), where
   * that is positive, on top of minSecPerM * distance. Without it a search over ground with cheap
   * descents has almost no sense of direction.
   */
  lift?: { heights: Float32Array; perM: number; perRiseM: number };
  /** Seconds added per radian of heading change at a turn. */
  turnSPerRad: number;
  /** Why the vehicle cannot start or stop on a cell, or null if it can. */
  endBlock(cell: number): EndBlock | null;
  words: CostWords;
}

/** Cell size for every row of a grid, metres. */
export function cellSizes(grid: Grid): Float64Array {
  const out = new Float64Array(grid.rows);
  for (let r = 0; r < grid.rows; r++) out[r] = grid.cellM(r);
  return out;
}

/**
 * A plain cost: one speed everywhere, optional blocked cells. Used by tests and wherever only the
 * shape of the ground matters.
 */
export function uniformCost(
  grid: Grid,
  options: { speedMs?: number; blocked?: Uint8Array; turnSPerRad?: number; words?: CostWords } = {},
): CostField {
  const blocked = options.blocked ?? new Uint8Array(grid.rows * grid.cols);
  const secPerM = 1 / (options.speedMs ?? 1);
  return {
    rows: grid.rows,
    cols: grid.cols,
    cellMByRow: cellSizes(grid),
    blocked,
    mult: null,
    gradE: null,
    gradN: null,
    pace: new Float64Array([secPerM]),
    paceTanMax: 1,
    minSecPerM: secPerM,
    turnSPerRad: options.turnSPerRad ?? 0,
    endBlock: (cell) => (blocked[cell] ? { kind: 'hazard', hazard: 'keepOut' } : null),
    words: options.words ?? { vehicle: 'the vehicle', climb: 'can climb', spot: 'clear spot' },
  };
}

/**
 * Seconds to travel the straight line from cell a to cell b, or Infinity if the line touches a
 * blocked cell or ground the vehicle cannot take in that direction. Every cell the line crosses is
 * counted for the length of line inside it (an exact grid walk, so no thin wall is stepped over).
 * A line through the shared corner of four cells is cut if either side cell is blocked.
 */
export function segmentCost(f: CostField, a: number, b: number): number {
  if (a === b) return 0;
  const cols = f.cols;
  const r0 = (a / cols) | 0;
  const c0 = a - r0 * cols;
  const r1 = (b / cols) | 0;
  const c1 = b - r1 * cols;
  const dr = r1 - r0;
  const dc = c1 - c0;
  const adr = dr < 0 ? -dr : dr;
  const adc = dc < 0 ? -dc : dc;
  const sr = dr < 0 ? -1 : 1;
  const sc = dc < 0 ? -1 : 1;
  const lenCells = Math.sqrt(dr * dr + dc * dc);
  const lenM = lenCells * (((f.cellMByRow[r0] as number) + (f.cellMByRow[r1] as number)) / 2);
  const ux = dc / lenCells;
  const un = -dr / lenCells;

  const { blocked, mult, gradE, gradN, pace } = f;
  const last = pace.length - 1;
  const scale = last / (2 * f.paceTanMax);
  const tanMax = f.paceTanMax;
  const level = pace[last >> 1] as number;

  let r = r0;
  let c = c0;
  let i = 0; // column boundaries crossed
  let j = 0; // row boundaries crossed
  let t = 0;
  let sum = 0;
  for (;;) {
    const cell = r * cols + c;
    let rate = level;
    if (gradE !== null && gradN !== null) {
      const tan = (gradE[cell] as number) * ux + (gradN[cell] as number) * un;
      let idx = ((tan + tanMax) * scale + 0.5) | 0;
      if (idx < 0) idx = 0;
      else if (idx > last) idx = last;
      rate = pace[idx] as number;
    }
    if (mult !== null) rate *= mult[cell] as number;
    if (!(rate < Infinity)) return Infinity;

    if (i >= adc && j >= adr) {
      sum += (1 - t) * rate;
      break;
    }
    // The next column boundary is at t = (2i + 1) / (2 adc), the next row boundary at (2j + 1) / (2 adr).
    // Compare them as whole numbers so a pass through a cell corner is seen exactly.
    const ax = i < adc ? (2 * i + 1) * adr : Infinity;
    const ay = j < adr ? (2 * j + 1) * adc : Infinity;
    let tn: number;
    if (ax < ay) {
      tn = (2 * i + 1) / (2 * adc);
      c += sc;
      i++;
    } else if (ay < ax) {
      tn = (2 * j + 1) / (2 * adr);
      r += sr;
      j++;
    } else {
      tn = (2 * i + 1) / (2 * adc);
      if (blocked[r * cols + c + sc] || blocked[(r + sr) * cols + c]) return Infinity;
      c += sc;
      r += sr;
      i++;
      j++;
    }
    sum += (tn - t) * rate;
    t = tn;
    if (blocked[r * cols + c]) return Infinity;
  }
  return sum * lenM;
}

/** Metres between two cells. */
function cellDistanceM(f: CostField, a: number, b: number): number {
  const cols = f.cols;
  const ra = (a / cols) | 0;
  const rb = (b / cols) | 0;
  const dr = rb - ra;
  const dc = b - rb * cols - (a - ra * cols);
  return Math.sqrt(dr * dr + dc * dc) * (((f.cellMByRow[ra] as number) + (f.cellMByRow[rb] as number)) / 2);
}

/** Seconds for the change of heading at `at`, arriving from `from` and leaving for `to`. */
function turnCost(f: CostField, from: number, at: number, to: number): number {
  const k = f.turnSPerRad;
  if (k === 0 || from === at || from < 0) return 0;
  const cols = f.cols;
  const rf = (from / cols) | 0;
  const ra = (at / cols) | 0;
  const rt = (to / cols) | 0;
  const ax = at - ra * cols - (from - rf * cols);
  const ay = ra - rf;
  const bx = to - rt * cols - (at - ra * cols);
  const by = rt - ra;
  const la = Math.sqrt(ax * ax + ay * ay);
  const lb = Math.sqrt(bx * bx + by * by);
  if (la === 0 || lb === 0) return 0;
  const cos = (ax * bx + ay * by) / (la * lb);
  return k * Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos);
}

/** The least a way from one cell to another can cost, seconds: the search heuristic. */
export function lowerBoundS(f: CostField, from: number, to: number): number {
  const d = cellDistanceM(f, from, to);
  let bound = d * f.minSecPerM;
  const lift = f.lift;
  if (lift) {
    const work = lift.perM * d + lift.perRiseM * ((lift.heights[to] as number) - (lift.heights[from] as number));
    if (work > 0) bound += work;
  }
  return bound;
}

/* ---------- Lazy Theta* ---------- */

export type SearchResult =
  | { ok: true; cells: number[]; costS: number; expanded: number }
  | { ok: false; reason: 'noPath' | 'tooFar' | 'cancelled'; expanded: number };

export interface SearchOptions {
  /** Give up with 'tooFar' after this many cells. Default 1.5 million. */
  maxExpansions?: number;
  /** Asked between batches; true stops the search with 'cancelled'. */
  shouldCancel?: () => boolean;
  /** Cells per batch between progress and cancellation checks. Default 8192. */
  batch?: number;
  /**
   * How hard the search leans towards the goal: the lower bound on the cost still to come is
   * multiplied by this. 1 is plain A* order; a little more opens far fewer cells on rough ground
   * for a route a few percent dearer at worst. Default HEURISTIC_WEIGHT.
   */
  heuristicWeight?: number;
  /**
   * The longest straight line the search itself tries, in cells. Longer runs are joined up when the
   * route is pulled tight at the end. Without a limit, open ground makes every opened cell walk a
   * line all the way back to the last corner. Default MAX_LINE_CELLS.
   */
  maxLineCells?: number;
}

export const DEFAULT_MAX_EXPANSIONS = 1_500_000;
/**
 * Measured on rough synthetic ground (1.4 million cells, every vehicle and style): 1.3 opened up to
 * 15 times fewer cells than 1 and never gave a route more than 1% dearer; 1.5 cost up to 3%.
 */
export const HEURISTIC_WEIGHT = 1.3;
export const MAX_LINE_CELLS = 64;
const DEFAULT_BATCH = 8192;
const CLOSED = 1;
const VERIFIED = 2;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * A search that can be run a batch at a time, so a worker can look at its messages in between.
 *
 * Lazy Theta*: when a cell is opened, each neighbour is first offered the opened cell's parent as its
 * own parent (a straight line that skips the cell), with the line's cost guessed from the line just
 * walked. The guess is checked only when that neighbour is itself opened: the true line is walked
 * then, and if it is cut or dearer than guessed the neighbour falls back to the best cell beside it
 * and goes back in the queue under its true cost.
 */
export class ThetaSearch {
  readonly expandedLimit: number;
  private readonly f: CostField;
  private readonly goal: number;
  private readonly g: Float64Array;
  private readonly key: Float64Array;
  private readonly parent: Int32Array;
  private readonly flags: Uint8Array;
  private readonly heap = new MinHeap(4096);
  private readonly h0: number;
  private readonly weight: number;
  private readonly maxLine2: number;
  private expanded = 0;
  private best = 0;
  private done: SearchResult | null = null;

  constructor(
    cost: CostField,
    startCell: number,
    goalCell: number,
    maxExpansions = DEFAULT_MAX_EXPANSIONS,
    heuristicWeight = HEURISTIC_WEIGHT,
    maxLineCells = MAX_LINE_CELLS,
  ) {
    const n = cost.rows * cost.cols;
    if (!(startCell >= 0 && startCell < n && goalCell >= 0 && goalCell < n)) {
      throw new Error('The start and goal must be cells of the grid.');
    }
    this.f = cost;
    this.goal = goalCell;
    this.expandedLimit = maxExpansions;
    this.weight = heuristicWeight >= 1 ? heuristicWeight : 1;
    this.maxLine2 = Math.max(1, maxLineCells) ** 2;
    this.g = new Float64Array(n).fill(Infinity);
    this.key = new Float64Array(n).fill(Infinity);
    this.parent = new Int32Array(n).fill(-1);
    this.flags = new Uint8Array(n);
    this.h0 = this.heuristic(startCell);
    this.g[startCell] = 0;
    this.key[startCell] = this.h0;
    this.parent[startCell] = startCell;
    this.flags[startCell] = VERIFIED;
    this.heap.push(startCell, this.h0);
  }

  /** How far the search has got towards the goal, 0 to 1. Never goes down. */
  get fraction(): number {
    return this.best;
  }

  get expandedCount(): number {
    return this.expanded;
  }

  private heuristic(cell: number): number {
    return this.weight * lowerBoundS(this.f, cell, this.goal);
  }

  private turn(from: number, at: number, to: number): number {
    return turnCost(this.f, from, at, to);
  }

  /**
   * Run up to `budget` more cells. Returns the result when the search has ended, else null.
   */
  run(budget: number): SearchResult | null {
    if (this.done) return this.done;
    const f = this.f;
    const { rows, cols, blocked } = f;
    const g = this.g;
    const key = this.key;
    const parent = this.parent;
    const flags = this.flags;
    const heap = this.heap;
    let left = budget;

    while (left > 0) {
      const s = heap.pop();
      if (s < 0) return this.finish({ ok: false, reason: 'noPath', expanded: this.expanded });
      const popped = heap.lastKey;
      const flag = flags[s] as number;
      // Stale entries: the cell is done, or was since given a different key. Both sides are float64.
      if (flag & CLOSED || popped !== (key[s] as number)) continue;
      left--;

      if (!(flag & VERIFIED)) {
        // Check the guessed straight line from the parent; fall back to the best finished neighbour.
        const p = parent[s] as number;
        const guessed = g[s] as number;
        let best = (g[p] as number) + segmentCost(f, p, s) + this.turn(parent[p] as number, p, s);
        let bestParent = p;
        if (best > guessed * (1 + 1e-9) + 1e-9) {
          const sr = (s / cols) | 0;
          const sc = s - sr * cols;
          for (const [dr, dc] of NEIGHBOURS) {
            const nr = sr + dr;
            const nc = sc + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            const n = nr * cols + nc;
            if (!((flags[n] as number) & CLOSED)) continue;
            const via = (g[n] as number) + segmentCost(f, n, s) + this.turn(parent[n] as number, n, s);
            if (via < best) {
              best = via;
              bestParent = n;
            }
          }
        }
        if (!(best < Infinity)) {
          // Not reachable by anything known yet; a later cell may still offer a way in.
          g[s] = Infinity;
          key[s] = Infinity;
          parent[s] = -1;
          continue;
        }
        g[s] = best;
        parent[s] = bestParent;
        flags[s] = VERIFIED;
        const fresh = best + this.heuristic(s);
        key[s] = fresh;
        if (fresh > popped * (1 + 1e-9) + 1e-9) {
          // Dearer than guessed: other cells may now come first, so queue it again under its true cost.
          heap.push(s, fresh);
          continue;
        }
      }

      flags[s] = (flags[s] as number) | CLOSED;
      this.expanded++;
      if (s === this.goal) return this.finish(this.trace());
      if (this.expanded >= this.expandedLimit) {
        return this.finish({ ok: false, reason: 'tooFar', expanded: this.expanded });
      }
      if (this.h0 > 0) {
        const got = 1 - this.heuristic(s) / this.h0;
        if (got > this.best) this.best = got;
      }

      const p = parent[s] as number;
      const gs = g[s] as number;
      const gp = g[p] as number;
      const sr = (s / cols) | 0;
      const sc = s - sr * cols;
      const pr = (p / cols) | 0;
      const pc = p - pr * cols;
      const dps = Math.sqrt((sr - pr) ** 2 + (sc - pc) ** 2);
      const maxLine2 = this.maxLine2;
      for (const [dr, dc] of NEIGHBOURS) {
        const nr = sr + dr;
        const nc = sc + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const n = nr * cols + nc;
        if (blocked[n] || (flags[n] as number) & CLOSED) continue;
        // Path 1: step from s. Exact.
        let cand = gs + segmentCost(f, s, n) + this.turn(p, s, n);
        let candParent = s;
        let candFlag = VERIFIED;
        const dpn2 = (nr - pr) ** 2 + (nc - pc) ** 2;
        if (dps > 0 && dpn2 <= maxLine2) {
          // Path 2: straight from the parent of s, guessed from the line just walked to s.
          const guess = gp + (gs - gp) * (Math.sqrt(dpn2) / dps);
          if (guess < cand) {
            cand = guess;
            candParent = p;
            candFlag = 0;
          }
        }
        if (cand < (g[n] as number)) {
          g[n] = cand;
          parent[n] = candParent;
          flags[n] = candFlag;
          const fk = cand + this.heuristic(n);
          key[n] = fk;
          heap.push(n, fk);
        }
      }
    }
    return null;
  }

  private finish(result: SearchResult): SearchResult {
    this.done = result;
    if (result.ok) this.best = 1;
    return result;
  }

  private trace(): SearchResult {
    const cells: number[] = [];
    let at = this.goal;
    for (let guard = this.f.rows * this.f.cols + 1; guard > 0; guard--) {
      cells.push(at);
      const p = this.parent[at] as number;
      if (p === at || p < 0) break;
      at = p;
    }
    cells.reverse();
    const tight = pullTight(this.f, cells);
    return { ok: true, cells: tight, costS: pathCostS(this.f, tight), expanded: this.expanded };
  }
}

/** What a path through these corners costs, seconds: its straight lines and its turns. */
export function pathCostS(f: CostField, cells: readonly number[]): number {
  let sum = 0;
  for (let i = 1; i < cells.length; i++) {
    sum += segmentCost(f, cells[i - 1] as number, cells[i] as number);
    if (i >= 2) sum += turnCost(f, cells[i - 2] as number, cells[i - 1] as number, cells[i] as number);
  }
  return sum;
}

/**
 * Drop corners a straight line can skip at no extra cost, again and again until none is left. This
 * is also what joins the search's short lines into the long straight runs of open ground.
 */
function pullTight(f: CostField, cells: number[]): number[] {
  const look = 24;
  let path = cells;
  for (let pass = 0; pass < 16 && path.length > 2; pass++) {
    const prefix = new Float64Array(path.length);
    for (let i = 1; i < path.length; i++) {
      prefix[i] = (prefix[i - 1] as number) + segmentCost(f, path[i - 1] as number, path[i] as number);
    }
    const out: number[] = [path[0] as number];
    let i = 0;
    const end = path.length - 1;
    while (i < end) {
      let next = i + 1;
      for (let j = Math.min(end, i + look); j >= i + 2; j--) {
        const along = (prefix[j] as number) - (prefix[i] as number);
        if (segmentCost(f, path[i] as number, path[j] as number) <= along * (1 + 1e-9)) {
          next = j;
          break;
        }
      }
      out.push(path[next] as number);
      i = next;
    }
    if (out.length === path.length) break;
    path = out;
  }
  return path;
}

/**
 * Any-angle search from one cell to another (cells are row * cols + col). The path comes back as the
 * cells where it turns; on open level ground that is just the two ends. Never hangs: it stops with
 * 'tooFar' at the expansion cap and 'cancelled' when asked between batches.
 */
export function lazyThetaStar(
  grid: Grid,
  cost: CostField,
  startCell: number,
  goalCell: number,
  onProgress?: (fraction: number) => void,
  options: SearchOptions = {},
): SearchResult {
  if (grid.rows !== cost.rows || grid.cols !== cost.cols) {
    throw new Error('The cost field does not match the grid.');
  }
  const search = new ThetaSearch(cost, startCell, goalCell, options.maxExpansions, options.heuristicWeight, options.maxLineCells);
  const batch = options.batch ?? DEFAULT_BATCH;
  for (;;) {
    const result = search.run(batch);
    if (result) {
      if (result.ok) onProgress?.(1);
      return result;
    }
    onProgress?.(search.fraction);
    if (options.shouldCancel?.()) return { ok: false, reason: 'cancelled', expanded: search.expandedCount };
  }
}

/* ---------- request to reply ---------- */

export interface RouteRunOptions extends SearchOptions {
  onProgress?: (fraction: number) => void;
}

/** How far to look for ground the vehicle can stand on when an end is blocked, metres. */
export const NEAREST_WITHIN_M = 2000;
/** Cells flooded from each end to spot an end walled into a small pocket before the long search. */
const POCKET_CELLS = 20_000;
/** A reply path is sampled about every cell, but never into more points than this. */
const MAX_PATH_POINTS = 3000;

type Prepared = { reply: RouteReply } | { start: number; goal: number };

/**
 * Route a request on a grid. Returns the reply, or null if the search was cancelled.
 * Failures come back typed, with a message in plain words:
 * - outsideRegion: an end is outside the region or the grid
 * - blockedStart, blockedEnd: an end is on ground the vehicle cannot stand on, or inside a hazard
 *   zone; `nearest` is the closest usable point within 2 km, if there is one
 * - noPath: no way through
 * - tooFar: the search hit its cap
 */
export function routeOnGrid(
  request: RouteRequest,
  grid: Grid,
  cost: CostField,
  options: RouteRunOptions = {},
): RouteReply | null {
  const ready = prepare(request, grid, cost);
  if ('reply' in ready) return ready.reply;
  const result = lazyThetaStar(grid, cost, ready.start, ready.goal, options.onProgress, options);
  return conclude(request, grid, cost, result);
}

/**
 * The same, pausing between batches so the caller's thread can take messages (a cancel, say).
 * `pause` resolves when the search may go on.
 */
export async function routeOnGridAsync(
  request: RouteRequest,
  grid: Grid,
  cost: CostField,
  options: RouteRunOptions & { pause: () => Promise<void> },
): Promise<RouteReply | null> {
  const ready = prepare(request, grid, cost);
  if ('reply' in ready) return ready.reply;
  const search = new ThetaSearch(cost, ready.start, ready.goal, options.maxExpansions, options.heuristicWeight, options.maxLineCells);
  const batch = options.batch ?? DEFAULT_BATCH;
  for (;;) {
    if (options.shouldCancel?.()) return null;
    const result = search.run(batch);
    if (result) {
      if (result.ok) options.onProgress?.(1);
      return conclude(request, grid, cost, result);
    }
    options.onProgress?.(search.fraction);
    await options.pause();
  }
}

function prepare(request: RouteRequest, grid: Grid, cost: CostField): Prepared {
  if (grid.rows !== cost.rows || grid.cols !== cost.cols) {
    throw new Error('The cost field does not match the grid.');
  }
  const fail = (
    reason: Extract<RouteReply, { ok: false }>['reason'],
    message: string,
    nearest?: LonLat,
  ): Prepared => ({
    reply: {
      ok: false,
      requestId: request.requestId,
      style: request.style,
      reason,
      message,
      ...(nearest ? { nearest } : {}),
    },
  });

  const ends = [
    { which: 'start', point: request.from, reason: 'blockedStart' },
    { which: 'end', point: request.to, reason: 'blockedEnd' },
  ] as const;

  const cells: number[] = [];
  for (const end of ends) {
    const [lon, lat] = end.point;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inBox(REGION, lon, lat)) {
      return fail(
        'outsideRegion',
        `The ${end.which} point is outside the mapped region. Routes are limited to Jezero and Nili Fossae, ` +
          `${REGION[1]} to ${REGION[3]} N and ${REGION[0]} to ${REGION[2]} E.`,
      );
    }
    const row = Math.round(grid.rowOf(lat));
    const col = Math.round(grid.colOf(lon));
    if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) {
      return fail('outsideRegion', `The ${end.which} point is outside the terrain loaded for this route.`);
    }
    cells.push(row * grid.cols + col);
  }

  for (let i = 0; i < ends.length; i++) {
    const end = ends[i];
    const cell = cells[i];
    if (!end || cell === undefined) continue;
    const block = cost.endBlock(cell);
    if (!block) continue;
    const near = nearestOpenCell(grid, cost, cell, NEAREST_WITHIN_M);
    const w = cost.words;
    const what =
      block.kind === 'steep'
        ? `The ${end.which} point is on ground steeper than ${w.vehicle} ${w.climb} (${Math.round(block.slopeDeg)} degrees).`
        : `The ${end.which} point is inside ${HAZARD_WORDS[block.hazard]}.`;
    const spot = block.kind === 'steep' ? w.spot : 'clear spot';
    const where = near
      ? `The nearest ${spot} is ${formatDistance(near.distM)} away.`
      : `There is no ${spot} within ${formatDistance(NEAREST_WITHIN_M)}.`;
    return fail(end.reason, `${what} ${where}`, near?.point);
  }

  const start = cells[0] as number;
  const goal = cells[1] as number;
  if (start !== goal && (walledIn(cost, goal, start) || walledIn(cost, start, goal))) {
    return fail('noPath', noPathMessage(cost));
  }
  return { start, goal };
}

function conclude(request: RouteRequest, grid: Grid, cost: CostField, result: SearchResult): RouteReply | null {
  const base = { requestId: request.requestId, style: request.style };
  if (result.ok) {
    return {
      ok: true,
      ...base,
      path: pathFromCells(grid, result.cells, request.from, request.to),
      gridCellM: grid.cellWidthM,
      expanded: result.expanded,
    };
  }
  if (result.reason === 'cancelled') return null;
  if (result.reason === 'tooFar') {
    return {
      ok: false,
      ...base,
      reason: 'tooFar',
      message: 'These points are too far apart to route in one go. Add a stop between them.',
    };
  }
  return { ok: false, ...base, reason: 'noPath', message: noPathMessage(cost) };
}

const HAZARD_WORDS: Record<HazardZone['kind'], string> = {
  dustDevil: 'a dust devil zone',
  storm: 'a storm zone',
  steep: 'a steep ground zone',
  keepOut: 'a keep-out zone',
};

function noPathMessage(cost: CostField): string {
  return `There is no way through for ${cost.words.vehicle}: steep ground or a hazard zone cuts the start off from the end.`;
}

/** "140 m", "1.4 km". */
function formatDistance(m: number): string {
  if (m < 995) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = (m / 1000).toFixed(1);
  return `${km.endsWith('.0') ? km.slice(0, -2) : km} km`;
}

/** The closest cell the vehicle can stand on within a distance, with how far it is. */
export function nearestOpenCell(
  grid: Grid,
  cost: CostField,
  cell: number,
  withinM: number,
): { cell: number; point: LonLat; distM: number } | null {
  const { rows, cols } = cost;
  const r0 = (cell / cols) | 0;
  const c0 = cell - r0 * cols;
  const size = cost.cellMByRow[r0] as number;
  const reach = Math.ceil(withinM / size);
  let best = -1;
  let bestD2 = Infinity;
  const limit2 = (withinM / size) ** 2;
  for (let r = Math.max(0, r0 - reach); r <= Math.min(rows - 1, r0 + reach); r++) {
    for (let c = Math.max(0, c0 - reach); c <= Math.min(cols - 1, c0 + reach); c++) {
      const d2 = (r - r0) ** 2 + (c - c0) ** 2;
      if (d2 >= bestD2 || d2 > limit2) continue;
      const n = r * cols + c;
      if (cost.blocked[n] || cost.endBlock(n)) continue;
      best = n;
      bestD2 = d2;
    }
  }
  if (best < 0) return null;
  const br = (best / cols) | 0;
  return { cell: best, point: [grid.lonOf(best - br * cols), grid.latOf(br)], distM: Math.sqrt(bestD2) * size };
}

/**
 * True if the open ground around `from` is a small pocket that does not hold `other`: flood up to a
 * fixed number of cells and see whether the flood runs out.
 */
function walledIn(cost: CostField, from: number, other: number): boolean {
  const { rows, cols, blocked } = cost;
  const seen = new Uint8Array(rows * cols);
  const queue = new Int32Array(POCKET_CELLS);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  seen[from] = 1;
  while (head < tail) {
    const s = queue[head++] as number;
    if (s === other) return false;
    const sr = (s / cols) | 0;
    const sc = s - sr * cols;
    for (const [dr, dc] of NEIGHBOURS) {
      const nr = sr + dr;
      const nc = sc + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const n = nr * cols + nc;
      if (seen[n] || blocked[n]) continue;
      if (dr !== 0 && dc !== 0 && (blocked[sr * cols + nc] || blocked[nr * cols + sc])) continue;
      if (tail >= POCKET_CELLS) return false; // Not a small pocket; let the real search decide.
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return true;
}

/** Turn the cells where a route bends into a path sampled about every cell, with heights. */
export function pathFromCells(grid: Grid, cells: readonly number[], from?: LonLat, to?: LonLat): PathPoint[] {
  const cols = grid.cols;
  const corners: { row: number; col: number }[] = cells.map((cell) => {
    const row = (cell / cols) | 0;
    return { row, col: cell - row * cols };
  });
  // The ends are the points asked for, not the centres of the cells that hold them.
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (from && first) corners[0] = { row: grid.rowOf(from[1]), col: grid.colOf(from[0]) };
  if (to && last) {
    const end = { row: grid.rowOf(to[1]), col: grid.colOf(to[0]) };
    if (corners.length > 1) corners[corners.length - 1] = end;
    else corners.push(end);
  }
  let total = 0;
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    if (a && b) total += Math.hypot(b.row - a.row, b.col - a.col);
  }
  const spacing = Math.max(1, total / MAX_PATH_POINTS);
  const out: PathPoint[] = [];
  const add = (row: number, col: number): void => {
    const lon = grid.lonOf(col);
    const lat = grid.latOf(row);
    out.push([lon, lat, grid.elevation(lat, lon)]);
  };
  const head = corners[0];
  if (head) add(head.row, head.col);
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    if (!a || !b) continue;
    const len = Math.hypot(b.row - a.row, b.col - a.col);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      add(a.row + (b.row - a.row) * t, a.col + (b.col - a.col) * t);
    }
  }
  // Pin the ends to the exact coordinates asked for (the round trip through rows and columns is
  // good to a fraction of a millimetre, but the map compares them with its pins).
  const tail = out[out.length - 1];
  if (from && out[0]) out[0] = [from[0], from[1], out[0][2]];
  if (to && tail && out.length > 1) out[out.length - 1] = [to[0], to[1], tail[2]];
  return out;
}
