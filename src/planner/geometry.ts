import type { PathPoint, TripResult } from '@/engines/types';
import { distanceM } from '@/lib/geo';

/** Facts about a path that need only its shape: no vehicle, no clock. */
export interface PathStats {
  distM: number;
  climbM: number;
  descentM: number;
  /** Steepest stretch, measured over at least `baseM` of ground, degrees. */
  maxGradeDeg: number;
  /** Distance from the start to each point, m. */
  along: Float64Array;
}

export function pathStats(path: readonly PathPoint[], baseM = 60): PathStats {
  const along = new Float64Array(path.length);
  let climbM = 0;
  let descentM = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    along[i] = (along[i - 1] ?? 0) + distanceM(a[0], a[1], b[0], b[1]);
    const dz = b[2] - a[2];
    if (dz > 0) climbM += dz;
    else descentM -= dz;
  }
  // Grade over a base length, so one noisy cell does not read as a cliff.
  let maxGradeDeg = 0;
  let j = 0;
  for (let i = 1; i < path.length; i += 1) {
    while (j < i - 1 && (along[i] ?? 0) - (along[j + 1] ?? 0) >= baseM) j += 1;
    const run = (along[i] ?? 0) - (along[j] ?? 0);
    const pi = path[i];
    const pj = path[j];
    if (run >= Math.min(baseM, 1) && pi && pj) {
      maxGradeDeg = Math.max(maxGradeDeg, (Math.atan(Math.abs(pi[2] - pj[2]) / Math.max(run, 1e-6)) * 180) / Math.PI);
    }
  }
  return { distM: along[path.length - 1] ?? 0, climbM, descentM, maxGradeDeg, along };
}

/** Signed grade at each point over a base length, degrees; uphill positive in the direction of travel. */
export function gradesAlong(path: readonly PathPoint[], along: Float64Array, baseM = 60): Float32Array {
  const out = new Float32Array(path.length);
  let j = 0;
  for (let i = 0; i < path.length; i += 1) {
    while (j < i - 1 && (along[i] ?? 0) - (along[j + 1] ?? 0) >= baseM) j += 1;
    const run = (along[i] ?? 0) - (along[j] ?? 0);
    const pi = path[i];
    const pj = path[j];
    out[i] = run > 0.5 && pi && pj ? (Math.atan((pi[2] - pj[2]) / run) * 180) / Math.PI : 0;
  }
  if (path.length > 1) out[0] = out[1] ?? 0;
  return out;
}

/**
 * A trip result holding only what the shape of the path gives. It stands in where the trip
 * computer is not available, so routes can still be compared, drawn and listed.
 */
export function shapeOnlyTrip(path: readonly PathPoint[]): TripResult {
  const s = pathStats(path);
  return {
    totals: {
      distM: s.distM,
      durationS: 0,
      movingS: 0,
      workS: 0,
      waitS: 0,
      climbM: s.climbM,
      descentM: s.descentM,
      maxGradeDeg: s.maxGradeDeg,
      energyKWh: 0,
      solarKWh: 0,
      o2Kg: 0,
      waterL: 0,
      doseMSv: 0,
      minTempC: 0,
      maxTau: 0,
      arriveUtcMs: 0,
      minO2Frac: null,
      minBatteryFrac: null,
    },
    samples: [],
    warnings: [],
    feasible: true,
    limitHit: null,
    pointOfNoReturnIndex: null,
    o2OutIndex: null,
    walkbackIndex: null,
    nightStops: [],
  };
}

/** The point a distance along a path, between its recorded points. Clamped to the path's ends. */
export function pointAlong(path: readonly PathPoint[], along: Float64Array, distM: number): PathPoint {
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return [0, 0, 0];
  if (!(distM > 0)) return first;
  if (distM >= (along[path.length - 1] ?? 0)) return last;
  // Binary search for the segment that holds the distance.
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((along[mid] ?? 0) <= distM) lo = mid;
    else hi = mid;
  }
  const a = path[lo] ?? first;
  const b = path[hi] ?? last;
  const span = (along[hi] ?? 0) - (along[lo] ?? 0);
  const t = span > 0 ? (distM - (along[lo] ?? 0)) / span : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A flight along a route takes about 2 s per km, never under 14 s or over 45 s. */
export function flyoverSeconds(distM: number): number {
  return Math.max(14, Math.min(45, (distM / 1000) * 2));
}

/** How far along a flight the camera is at a share of its time: slow away, steady, slow in. */
export function flyoverEase(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  // A quarter of the time to get up to speed and a quarter to slow down.
  const ramp = 0.25;
  const cruise = 1 / (1 - ramp);
  if (x < ramp) return (cruise * x * x) / (2 * ramp);
  if (x > 1 - ramp) return 1 - (cruise * (1 - x) * (1 - x)) / (2 * ramp);
  return cruise * (x - ramp / 2);
}
