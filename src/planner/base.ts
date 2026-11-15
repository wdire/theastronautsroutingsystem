/**
 * The crew's base: where every crewed mission starts and where it comes back to. There is one, shared by
 * everyone through the crew server (convex/base.ts); this browser keeps the last one it saw, and keeps its own
 * when there is no crew server.
 */
import type { MissionPlan, Waypoint } from '@/engines/types';
import { inBox, REGION } from '@/lib/constants';
import { distanceM } from '@/lib/geo';

export interface Base {
  lon: number;
  lat: number;
  name: string;
  /** Who last moved it and when, ms, when the crew server says. */
  movedBy?: string;
  movedAt?: number;
}

/**
 * On the crater floor 2 km south-south-west of where Perseverance landed: the most level ground near it (no
 * slope over 1.6 degrees within 70 m, on the package's finest terrain), and clear of the landing site itself.
 */
export const DEFAULT_BASE: Base = { lon: 77.44, lat: 18.428, name: 'Jezero Station' };

/** The steepest ground a base may stand on, degrees (assumption: habitats and landers want under about 8). */
export const BASE_MAX_SLOPE_DEG = 8;

const KEY = 'areo.base.v1';

export function loadBase(): Base {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BASE;
    const b = JSON.parse(raw) as Partial<Base>;
    if (typeof b.lon === 'number' && typeof b.lat === 'number' && inBox(REGION, b.lon, b.lat)) {
      return { lon: b.lon, lat: b.lat, name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : DEFAULT_BASE.name };
    }
  } catch {
    // Private windows and blocked storage: the default base is fine.
  }
  return DEFAULT_BASE;
}

export function saveBase(base: Base): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(base));
  } catch {
    // Not saved: the base holds for this visit only.
  }
}

export function baseWaypoint(base: Base): Waypoint {
  return { lon: base.lon, lat: base.lat, name: base.name };
}

/** The plan as it must be flown from this base: out from it and back to it. */
export function withBase(plan: MissionPlan, base: Base): MissionPlan {
  return { ...plan, start: baseWaypoint(base), roundTrip: true };
}

/** True when the plan starts at this base (a plan shared by another commander starts at theirs). */
export function startsAtBase(plan: MissionPlan, base: Base): boolean {
  return plan.start !== null && distanceM(plan.start.lon, plan.start.lat, base.lon, base.lat) < 5;
}

/** Why a spot will not do for a base, or null if it will. `slopeDeg` is the ground there, if known. */
export function baseSpotProblem(lon: number, lat: number, slopeDeg: number | null): string | null {
  if (!inBox(REGION, lon, lat)) return 'That is outside the mapped region. A base needs terrain the planner can route over.';
  if (slopeDeg !== null && slopeDeg > BASE_MAX_SLOPE_DEG) return `The ground there slopes ${slopeDeg.toFixed(0)} degrees. A base needs level ground, under ${BASE_MAX_SLOPE_DEG}.`;
  return null;
}
