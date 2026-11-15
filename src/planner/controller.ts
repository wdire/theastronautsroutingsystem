import { createRouter, RouteCancelledError, type Router } from '@/engines/router/client';
import type { PathPoint, RouteStyle, TripOptions, TripResult } from '@/engines/types';
import { loadGrid } from '@/data/dem';
import { useApp } from '@/store';
import { planRoutes, STYLES, type RoutingDeps } from './routing';

type ComputeTrip = (path: PathPoint[], opts: TripOptions) => TripResult;
type DaylightDeparture = NonNullable<RoutingDeps['daylightDeparture']>;

/**
 * The budget engines are looked up rather than imported, so the planner works, with shapes only, in a
 * build that does not have them, and picks them up without a code change once they exist.
 */
const tripModules = import.meta.glob<{ computeTrip?: ComputeTrip }>('../engines/tripComputer.ts');
const departureModules = import.meta.glob<{ daylightDeparture?: DaylightDeparture }>('../engines/departure.ts');

async function loadBudget(): Promise<{ computeTrip?: ComputeTrip; daylightDeparture?: DaylightDeparture }> {
  const [trip, departure] = await Promise.all(
    [Object.values(tripModules)[0], Object.values(departureModules)[0]].map((load) => (load ? load().catch(() => null) : null)),
  );
  const computeTrip = (trip as { computeTrip?: ComputeTrip } | null)?.computeTrip;
  const daylightDeparture = (departure as { daylightDeparture?: DaylightDeparture } | null)?.daylightDeparture;
  return { ...(computeTrip ? { computeTrip } : {}), ...(daylightDeparture ? { daylightDeparture } : {}) };
}

/**
 * Keeps the routes in the store in step with the plan. Every change to the plan, the vehicle, the
 * departure or the what-if weather starts a new run and cancels the old one; a run that is overtaken
 * never writes its result.
 */
export function startPlanner(): () => void {
  const routers = new Map<RouteStyle, Router>();
  let timer = 0;
  let running = -1;
  let disposed = false;
  let runCounter = 0;

  const routerFor = (style: RouteStyle): Router => {
    let r = routers.get(style);
    if (!r) {
      r = createRouter();
      routers.set(style, r);
    }
    return r;
  };

  const run = async () => {
    timer = 0;
    if (disposed) return;
    const s = useApp.getState();
    // One id per run: the plan revision alone would repeat when only the weather or the hour changes.
    runCounter += 1;
    const rev = runCounter;
    if (running >= 0) for (const r of routers.values()) r.cancel(running);
    running = rev;

    if (!s.plan.start || s.plan.stops.length === 0) {
      s.setRoute({ status: 'idle' });
      return;
    }
    s.setRoute({ status: 'routing', rev, progress: 0 });
    const budget = await loadBudget();
    const deps: RoutingDeps = {
      loadGrid: (box, maxCells) => loadGrid(box, maxCells),
      route: (style, request, grid, onProgress) => routerFor(style).route(request, grid, onProgress),
      isCurrent: (r) => !disposed && r === running,
      onProgress: (r, progress) => {
        if (r === running) useApp.getState().setRoute({ status: 'routing', rev: r, progress });
      },
      ...budget,
    };
    try {
      const result = await planRoutes(
        { rev, plan: s.plan, departUtcMs: s.departUtcMs ?? s.utcMs, autoDepart: s.departUtcMs === null, scenario: s.scenario, hazards: [] },
        deps,
      );
      if (result && rev === running && !disposed) useApp.getState().setRoute(result);
    } catch (err) {
      if (err instanceof RouteCancelledError || rev !== running || disposed) return;
      useApp.getState().setRoute({
        status: 'failed',
        rev,
        leg: 0,
        message: 'The route could not be worked out. Check the connection, then change the plan to try again.',
      });
    }
  };

  const schedule = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 280);
  };

  // "Leave now" is costed for the hour it was worked out: when the clock has moved on a quarter of an hour (or
  // was jumped in the clock menu), the plan is costed again, so Start never flies a budget for an hour gone by.
  const unsubscribe = useApp.subscribe(
    (s) => [s.planRev, s.scenario, s.departUtcMs, s.departUtcMs === null && !s.world ? Math.floor(s.utcMs / 900_000) : 0] as const,
    schedule,
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] },
  );
  if (useApp.getState().plan.start) schedule();

  return () => {
    disposed = true;
    unsubscribe();
    if (timer) window.clearTimeout(timer);
    for (const r of routers.values()) r.dispose();
    routers.clear();
  };
}

export { STYLES };
