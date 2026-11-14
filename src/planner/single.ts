import { loadGrid } from '@/data/dem';
import { DEFAULT_SCENARIO } from '@/engines/environment';
import { createRouter, type Router } from '@/engines/router/client';
import type { HazardZone, LonLat, RouteReply, RouteStyle, Scenario, VehicleId } from '@/engines/types';
import { LEG_CELLS, legBox } from './routing';

let router: Router | null = null;
// Far above the planner's own request ids, so the two never share one.
let nextId = 1_000_000;

export interface SingleRoute {
  from: LonLat;
  to: LonLat;
  vehicle: VehicleId;
  style: RouteStyle;
  departUtcMs: number;
  scenario?: Scenario;
  hazards?: HazardZone[];
  onProgress?: (fraction: number) => void;
}

/**
 * One route between two points, apart from the mission plan: for checking the planner against a real
 * drive, and for a new way round a hazard while a mission runs. Uses its own router worker, so it
 * never cancels the plan's routing or is cancelled by it.
 */
export async function routeOnce(input: SingleRoute): Promise<RouteReply & { cellM?: number }> {
  router ??= createRouter();
  const requestId = (nextId += 1);
  const grid = await loadGrid(legBox(input.from, input.to), LEG_CELLS);
  const reply = await router.route(
    { requestId, from: input.from, to: input.to, vehicle: input.vehicle, style: input.style, departUtcMs: input.departUtcMs, scenario: input.scenario ?? DEFAULT_SCENARIO, hazards: input.hazards ?? [] },
    grid.spec,
    input.onProgress ?? (() => undefined),
  );
  return { ...reply, cellM: grid.cellM };
}
