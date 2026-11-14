/**
 * Checking the planner against the ground truth: Perseverance's real drive. A leg of the real traverse
 * gives two ends; the planner routes between them; compareTracks says how far the plan strays from where
 * the rover actually went.
 */
import { MARS_RADIUS_M } from '../lib/constants';
import { haversineM, pathLengthM, resamplePath } from './terrain';
import type { PathPoint } from './types';

/** The shape of public/data/traverses/*.json. */
export interface TraverseWaypoint {
  sol: number;
  lon: number;
  lat: number;
  elev: number;
  /** Odometry so far, km. */
  distKm: number;
}

export interface Traverse {
  rover: string;
  name: string;
  path: PathPoint[];
  waypoints: TraverseWaypoint[];
}

export interface TrackComparison {
  /** Distance from each plan point to the nearest point of the real track, metres. */
  medianM: number;
  p90M: number;
  /** Share of plan points within 300 m of the real track, 0 to 1. */
  within300Frac: number;
  plannedLengthM: number;
  realLengthM: number;
  /** Plan points measured (one every 50 m). */
  samples: number;
}

const PLAN_STEP_M = 50;
const REAL_STEP_M = 20;
const NEAR_M = 300;
/** Bucket size of the search grid. About the distance that matters, so most queries touch nine buckets. */
const BUCKET_M = 250;
const RAD = Math.PI / 180;

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const a = sorted[lo] ?? NaN;
  const b = sorted[hi] ?? NaN;
  return a + (b - a) * (at - lo);
}

/**
 * Nearest-point lookups on a track through a bucket grid in a local flat projection. Over a few tens of
 * kilometres the flat distance is within a fraction of a metre of the great circle, and it lets the
 * 12,000-point real track be searched without comparing every pair.
 */
class NearestIndex {
  private readonly buckets = new Map<number, number[]>();
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly kx: number;
  private readonly ky = MARS_RADIUS_M * RAD;
  private minI = Infinity;
  private maxI = -Infinity;
  private minJ = Infinity;
  private maxJ = -Infinity;

  constructor(points: readonly PathPoint[], lat0: number) {
    this.kx = MARS_RADIUS_M * RAD * Math.cos(lat0 * RAD);
    this.xs = new Float64Array(points.length);
    this.ys = new Float64Array(points.length);
    points.forEach((p, n) => {
      const x = p[0] * this.kx;
      const y = p[1] * this.ky;
      this.xs[n] = x;
      this.ys[n] = y;
      const i = Math.floor(x / BUCKET_M);
      const j = Math.floor(y / BUCKET_M);
      this.minI = Math.min(this.minI, i);
      this.maxI = Math.max(this.maxI, i);
      this.minJ = Math.min(this.minJ, j);
      this.maxJ = Math.max(this.maxJ, j);
      const key = NearestIndex.key(i, j);
      const list = this.buckets.get(key);
      if (list) list.push(n);
      else this.buckets.set(key, [n]);
    });
  }

  private static key(i: number, j: number): number {
    // Bucket indices stay well inside +-2^20 for any point on Mars at this bucket size.
    return (i + 1_048_576) * 2_097_152 + (j + 1_048_576);
  }

  /** Distance to the nearest point, metres; Infinity for an empty track. */
  distanceM(lon: number, lat: number): number {
    if (this.xs.length === 0) return Infinity;
    const x = lon * this.kx;
    const y = lat * this.ky;
    const ci = Math.floor(x / BUCKET_M);
    const cj = Math.floor(y / BUCKET_M);
    // Rings needed to reach every bucket from here.
    const maxRing = Math.max(Math.abs(ci - this.minI), Math.abs(ci - this.maxI), Math.abs(cj - this.minJ), Math.abs(cj - this.maxJ));
    let best = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      // Every point in ring r is at least (r - 1) buckets away, so once the best beats that, stop.
      if (best <= (r - 1) * BUCKET_M) break;
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const list = this.buckets.get(NearestIndex.key(i, j));
          if (!list) continue;
          for (const n of list) {
            const d = Math.hypot((this.xs[n] ?? 0) - x, (this.ys[n] ?? 0) - y);
            if (d < best) best = d;
          }
        }
      }
    }
    return best;
  }
}

/**
 * How closely a planned path follows a real one: the plan is resampled every 50 m and the real track every
 * 20 m (so the nearest real point is never more than 10 m from the nearest real segment), then each plan
 * point is measured to its nearest real point.
 */
export function compareTracks(planned: readonly PathPoint[], real: readonly PathPoint[]): TrackComparison {
  const plan = resamplePath(planned, PLAN_STEP_M);
  const truth = resamplePath(real, REAL_STEP_M);
  const lat0 = truth.length ? truth.reduce((s, p) => s + p[1], 0) / truth.length : 0;
  const index = new NearestIndex(truth, lat0);
  const d = plan.map((p) => index.distanceM(p[0], p[1])).sort((a, b) => a - b);
  const near = d.filter((v) => v <= NEAR_M).length;
  return {
    medianM: percentile(d, 0.5),
    p90M: percentile(d, 0.9),
    within300Frac: d.length ? near / d.length : 0,
    plannedLengthM: pathLengthM(planned),
    realLengthM: pathLengthM(real),
    samples: d.length,
  };
}

/* ---------- Perseverance's legs ---------- */

export interface TraverseLeg {
  id: string;
  name: string;
  description: string;
  fromSol: number;
  toSol: number;
}

/** The drive split where the mission's own campaigns split it. */
export const M20_LEGS: readonly TraverseLeg[] = [
  {
    id: 'seitah-edge',
    name: 'Landing to the Séítah edge',
    description: 'The first campaign: south-west from the landing site across the crater floor to the edge of the Séítah dunes and ridges.',
    fromSol: 13,
    toSol: 199,
  },
  {
    id: 'floor-to-delta',
    name: 'Across the floor to the delta front',
    description: 'Back past the landing site and west across the crater floor to the foot of the old river delta.',
    fromSol: 350,
    toSol: 419,
  },
  {
    id: 'delta-front',
    name: 'Up the delta front',
    description: 'Climbing the layered face of the delta, the sediment laid down where a river met the lake.',
    fromSol: 694,
    toSol: 925,
  },
  {
    id: 'delta-to-rim',
    name: 'Delta top to the rim by Neretva Vallis',
    description: 'Across the top of the delta and up beside Neretva Vallis, the valley where the river came in, to the crater rim.',
    fromSol: 1063,
    toSol: 1429,
  },
  {
    id: 'along-rim',
    name: 'Along the rim',
    description: 'South-west along the western rim among some of the oldest rocks the rover has reached.',
    fromSol: 1429,
    toSol: 2022,
  },
];

/** The waypoint for a sol: that sol, or the nearest sol inside the leg when the rover logged none that day. */
function waypointFor(traverse: Traverse, sol: number, inward: 1 | -1): TraverseWaypoint | null {
  let best: TraverseWaypoint | null = null;
  let bestScore = Infinity;
  for (const w of traverse.waypoints) {
    const gap = (w.sol - sol) * inward;
    // A sol on the inside of the leg wins a tie, so the cut never reaches outside the leg.
    const score = gap >= 0 ? gap : -gap + 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

/**
 * The path index nearest a waypoint. The rover crosses its own track (it drove back past the landing site),
 * so among the points close to the waypoint the one whose distance along the path best matches the odometry
 * is taken; odometry and the mapped path differ by a few per cent, hence the scale.
 */
function indexFor(traverse: Traverse, along: readonly number[], w: TraverseWaypoint, scale: number): number {
  const { path } = traverse;
  const dist = path.map((p) => haversineM(p, [w.lon, w.lat]));
  const nearest = dist.reduce((m, d) => Math.min(m, d), Infinity);
  const reach = Math.max(30, nearest + 20);
  const want = w.distKm * 1000 * scale;
  let at = 0;
  let bestGap = Infinity;
  dist.forEach((d, i) => {
    if (d > reach) return;
    const gap = Math.abs((along[i] ?? 0) - want);
    if (gap < bestGap) {
      bestGap = gap;
      at = i;
    }
  });
  return at;
}

/** The part of the real path between the waypoints of a leg's first and last sol. */
export function legTrack(traverse: Traverse, leg: TraverseLeg): PathPoint[] {
  const { path } = traverse;
  if (path.length === 0) return [];
  const from = waypointFor(traverse, leg.fromSol, 1);
  const to = waypointFor(traverse, leg.toSol, -1);
  if (!from || !to) return [];
  const along: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    along.push((along[i - 1] ?? 0) + (a && b ? haversineM(a, b) : 0));
  }
  const lastKm = traverse.waypoints.reduce((m, w) => Math.max(m, w.distKm), 0);
  const scale = lastKm > 0 ? (along[along.length - 1] ?? 0) / (lastKm * 1000) : 1;
  const i0 = indexFor(traverse, along, from, scale);
  const i1 = indexFor(traverse, along, to, scale);
  return path.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
}
