import type {
  RouteAlternative,
  HazardZone,
  LonLat,
  MissionPlan,
  PathPoint,
  RouteCandidate,
  RouteReply,
  RouteRequest,
  RouteStyle,
  Scenario,
  TripOptions,
  TripResult,
  TripStop,
} from '@/engines/types';
import type { GridSpec } from '@/engines/terrain';
import { labelFor, meanSeparationM, mergeAlternatives, SAME_PATH_M } from '@/engines/router/alternatives';
import type { Box } from '@/lib/constants';
import { distanceM } from '@/lib/geo';
import { MARS_RADIUS_M } from '@/lib/constants';
import type { RouteState } from '@/store';
import { shapeOnlyTrip } from './geometry';

export const STYLES: readonly RouteStyle[] = ['safest', 'fastest', 'eco'];

/** Cells per leg. Small enough to answer in a second or two, fine enough to see a gully. */
export const LEG_CELLS = 520_000;

export interface PlanInput {
  rev: number;
  plan: MissionPlan;
  departUtcMs: number;
  scenario: Scenario;
  hazards: HazardZone[];
}

/** Everything the planner needs from outside, so it can be tested without a worker or a network. */
export interface RoutingDeps {
  loadGrid(box: Box, maxCells: number): Promise<{ spec: GridSpec; cellM: number }>;
  route(style: RouteStyle, request: RouteRequest, grid: GridSpec, onProgress: (fraction: number) => void): Promise<RouteReply>;
  /** False once a newer plan has replaced this one. */
  isCurrent(rev: number): boolean;
  onProgress(rev: number, fraction: number): void;
  /** The trip computer, when the build has one. */
  computeTrip?: (path: PathPoint[], opts: TripOptions) => TripResult;
}

/**
 * Without a trip computer there is no time, energy or oxygen to compare, so styles are merged
 * only when they follow the same ground, and no route is called quicker or cheaper than another.
 */
export function mergeByShape(candidates: readonly RouteCandidate[]): RouteAlternative[] {
  const out: RouteAlternative[] = [];
  for (const c of candidates) {
    const same = out.find((a) => meanSeparationM(a.path, c.path) < SAME_PATH_M);
    if (same) {
      same.styles.push(c.style);
      same.id = same.styles.join('+');
      same.label = labelFor(same.styles);
    } else {
      out.push({ id: c.style, styles: [c.style], label: labelFor([c.style]), badges: [], path: c.path, stopIndices: c.stopIndices, trip: c.trip });
    }
  }
  return out;
}

/** The box a leg is routed in: its ends, plus room to go around things. */
export function legBox(from: LonLat, to: LonLat): Box {
  const dist = distanceM(from[0], from[1], to[0], to[1]);
  const marginM = Math.max(1200, dist * 0.35);
  const dLat = (marginM / MARS_RADIUS_M) * (180 / Math.PI);
  const midLat = (from[1] + to[1]) / 2;
  const dLon = dLat / Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  return [Math.min(from[0], to[0]) - dLon, Math.min(from[1], to[1]) - dLat, Math.max(from[0], to[0]) + dLon, Math.max(from[1], to[1]) + dLat];
}

/** The points a plan visits in order, and how long the crew works at each. */
export function planPoints(plan: MissionPlan): { points: LonLat[]; workMin: number[]; names: (string | undefined)[] } | null {
  if (!plan.start || plan.stops.length === 0) return null;
  const points: LonLat[] = [[plan.start.lon, plan.start.lat]];
  const workMin = [0];
  const names: (string | undefined)[] = [plan.start.name];
  for (const stop of plan.stops) {
    points.push([stop.lon, stop.lat]);
    workMin.push(stop.tasks.reduce((sum, t) => sum + t.minutes, 0));
    names.push(stop.name);
  }
  if (plan.roundTrip) {
    points.push([plan.start.lon, plan.start.lat]);
    workMin.push(0);
    names.push(plan.start.name);
  }
  return { points, workMin, names };
}

/**
 * Routes a whole plan, leg by leg, in every style, then merges the styles that came out the same.
 * Resolves to null if a newer plan replaced this one while it worked: stale results are never returned.
 */
export async function planRoutes(input: PlanInput, deps: RoutingDeps): Promise<RouteState | null> {
  const { rev, plan } = input;
  const visit = planPoints(plan);
  if (!visit) return { status: 'idle' };
  const legs = visit.points.length - 1;
  const paths = new Map<RouteStyle, PathPoint[]>(STYLES.map((s) => [s, []]));
  const stopIndices = new Map<RouteStyle, number[]>(STYLES.map((s) => [s, [0]]));
  let cellM = 0;

  for (let leg = 0; leg < legs; leg += 1) {
    const from = visit.points[leg];
    const to = visit.points[leg + 1];
    if (!from || !to) continue;
    const grid = await deps.loadGrid(legBox(from, to), LEG_CELLS);
    if (!deps.isCurrent(rev)) return null;
    cellM = Math.max(cellM, grid.cellM);

    const fractions = STYLES.map(() => 0);
    const replies = await Promise.all(
      STYLES.map((style, i) =>
        deps.route(
          style,
          { requestId: rev, from, to, vehicle: plan.vehicle, style, departUtcMs: input.departUtcMs, scenario: input.scenario, hazards: input.hazards },
          grid.spec,
          (fraction) => {
            fractions[i] = fraction;
            if (deps.isCurrent(rev)) deps.onProgress(rev, (leg + fractions.reduce((a, b) => a + b, 0) / STYLES.length) / legs);
          },
        ),
      ),
    );
    if (!deps.isCurrent(rev)) return null;

    for (const reply of replies) {
      if (!reply.ok) {
        return { status: 'failed', rev, message: reply.message, leg, ...(reply.nearest ? { nearest: reply.nearest } : {}) };
      }
      const path = paths.get(reply.style);
      const indices = stopIndices.get(reply.style);
      if (!path || !indices) continue;
      // The first point of a leg repeats the last point of the one before it.
      const add = path.length > 0 ? reply.path.slice(1) : reply.path;
      for (const p of add) path.push(p);
      indices.push(path.length - 1);
    }
    deps.onProgress(rev, (leg + 1) / legs);
  }

  const candidates: RouteCandidate[] = STYLES.map((style) => {
    const path = paths.get(style) ?? [];
    const indices = stopIndices.get(style) ?? [];
    const stops: TripStop[] = [];
    for (let i = 1; i < indices.length; i += 1) {
      const work = visit.workMin[i] ?? 0;
      const index = indices[i];
      if (index === undefined) continue;
      if (work > 0) {
        const name = visit.names[i];
        stops.push({ index, workMin: work, ...(name ? { name } : {}) });
      }
    }
    const trip = deps.computeTrip
      ? deps.computeTrip(path, {
          vehicle: plan.vehicle,
          departUtcMs: input.departUtcMs,
          scenario: input.scenario,
          style,
          stops,
          campAtNight: plan.campAtNight,
        })
      : shapeOnlyTrip(path);
    return { style, path, stopIndices: indices, trip };
  });

  const alternatives = deps.computeTrip ? mergeAlternatives(candidates) : mergeByShape(candidates);
  const preferred = alternatives.find((a) => a.styles.includes(plan.style)) ?? alternatives[0];
  if (!preferred) return { status: 'failed', rev, message: 'No route came back. Try moving a stop.', leg: 0 };
  return { status: 'ready', rev, alternatives, selected: preferred.id, cellM, hasBudget: Boolean(deps.computeTrip) };
}
