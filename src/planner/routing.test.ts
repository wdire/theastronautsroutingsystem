import { describe, expect, it } from 'vitest';
import { legBox, planPoints, planRoutes, type RoutingDeps } from './routing';
import type { MissionPlan, PathPoint, RouteReply, RouteStyle } from '@/engines/types';
import { DEFAULT_SCENARIO } from '@/engines/environment';

const plan = (over: Partial<MissionPlan> = {}): MissionPlan => ({
  start: { lon: 77.45, lat: 18.44, name: 'Base' },
  stops: [
    { id: 'a', lon: 77.47, lat: 18.45, name: 'A', tasks: [{ id: 't', kind: 'sample', minutes: 45 }] },
    { id: 'b', lon: 77.49, lat: 18.46, tasks: [] },
  ],
  roundTrip: true,
  vehicle: 'foot',
  style: 'fastest',
  campAtNight: false,
  ...over,
});

const straight = (from: readonly [number, number], to: readonly [number, number], bend: number): PathPoint[] => [
  [from[0], from[1], 0],
  [(from[0] + to[0]) / 2 + bend, (from[1] + to[1]) / 2, 10],
  [to[0], to[1], 0],
];

function deps(over: Partial<RoutingDeps> = {}, state = { current: 1 }): RoutingDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadGrid: async () => ({ spec: { zoom: 12, px0: 0, py0: 0, step: 1, rows: 1, cols: 1, heights: new Float32Array(1) }, cellM: 20 }),
    route: async (style, request): Promise<RouteReply> => {
      calls.push(`${style}:${request.from.join(',')}`);
      // Safest takes a wide detour; fastest and eco share a line.
      return { ok: true, requestId: request.requestId, style, path: straight(request.from, request.to, style === 'safest' ? 0.04 : 0), gridCellM: 20, expanded: 10 };
    },
    isCurrent: (rev) => rev === state.current,
    onProgress: () => undefined,
    ...over,
  };
}

const input = (rev = 1, p = plan()) => ({ rev, plan: p, departUtcMs: 0, scenario: DEFAULT_SCENARIO, hazards: [] });

describe('planRoutes', () => {
  it('is idle without a start or without a stop', async () => {
    expect(await planRoutes(input(1, plan({ start: null })), deps())).toEqual({ status: 'idle' });
    expect(await planRoutes(input(1, plan({ stops: [] })), deps())).toEqual({ status: 'idle' });
  });

  it('routes every leg in every style, joins the legs and merges styles that agree', async () => {
    const d = deps();
    const state = await planRoutes(input(), d);
    if (state?.status !== 'ready') throw new Error('not ready');
    // Three legs (base, A, B, base) in three styles.
    expect(d.calls).toHaveLength(9);
    const merged = state.alternatives.find((a) => a.styles.includes('fastest'));
    expect(merged?.styles).toEqual(expect.arrayContaining(['fastest', 'eco']));
    expect(state.alternatives).toHaveLength(2);
    // Joined without repeating the shared point: 3 legs of 3 points make 7.
    expect(merged?.path).toHaveLength(7);
    expect(merged?.stopIndices).toEqual([0, 2, 4, 6]);
    expect(merged?.path[6]?.slice(0, 2)).toEqual([77.45, 18.44]);
    // The card opens on the style the plan asks for.
    expect(state.selected).toBe(merged?.id);
    expect(state.hasBudget).toBe(false);
  });

  it('leaves the return leg out of a one-way plan', async () => {
    const d = deps();
    const state = await planRoutes(input(1, plan({ roundTrip: false })), d);
    expect(d.calls).toHaveLength(6);
    expect(state?.status).toBe('ready');
  });

  it('reports a failed leg with its message and the nearest reachable point', async () => {
    const d = deps({
      route: async (style, request): Promise<RouteReply> =>
        request.from[0] === 77.47
          ? { ok: false, requestId: request.requestId, style, reason: 'blockedEnd', message: 'The end point is too steep.', nearest: [77.491, 18.461] }
          : { ok: true, requestId: request.requestId, style, path: straight(request.from, request.to, 0), gridCellM: 20, expanded: 1 },
    });
    expect(await planRoutes(input(), d)).toEqual({
      status: 'failed',
      rev: 1,
      message: 'The end point is too steep.',
      leg: 1,
      // The end of leg 2 is the plan's third point: the second stop.
      point: 2,
      nearest: [77.491, 18.461],
    });
  });

  it('drops its result when a newer plan arrives while it works', async () => {
    const state = { current: 1 };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = deps(
      {
        route: async (style: RouteStyle, request): Promise<RouteReply> => {
          await gate;
          return { ok: true, requestId: request.requestId, style, path: straight(request.from, request.to, 0), gridCellM: 20, expanded: 1 };
        },
      },
      state,
    );
    const first = planRoutes(input(1), slow);
    // The visitor edits the plan: revision 2 replaces revision 1 before the worker answers.
    state.current = 2;
    release();
    expect(await first).toBeNull();
    const second = await planRoutes(input(2), deps({}, state));
    expect(second?.status).toBe('ready');
  });

  it('passes the work at each stop to the trip computer when there is one', async () => {
    const seen: { index: number; workMin: number; name?: string }[][] = [];
    const d = deps({
      computeTrip: (path, opts) => {
        seen.push(opts.stops ?? []);
        return { ...emptyTrip(), totals: { ...emptyTrip().totals, distM: path.length } };
      },
    });
    const state = await planRoutes(input(), d);
    expect(state?.status === 'ready' && state.hasBudget).toBe(true);
    expect(seen[0]).toEqual([{ index: 2, workMin: 45, name: 'A' }]);
  });
});

describe('plan helpers', () => {
  it('lists the points a plan visits and the minutes of work at each', () => {
    expect(planPoints(plan())).toEqual({
      points: [
        [77.45, 18.44],
        [77.47, 18.45],
        [77.49, 18.46],
        [77.45, 18.44],
      ],
      workMin: [0, 45, 0, 0],
      names: ['Base', 'A', undefined, 'Base'],
    });
  });

  it('gives a leg room to go around things', () => {
    const box = legBox([77.45, 18.44], [77.45, 18.44]);
    // Even a zero-length leg gets 1.2 km of margin each way.
    expect((box[3] - box[1]) * 59_274.7).toBeGreaterThan(2300);
    const long = legBox([77.0, 18.0], [78.0, 18.0]);
    expect(long[0]).toBeLessThan(77.0);
    expect(long[2]).toBeGreaterThan(78.0);
    expect(long[3] - long[1]).toBeGreaterThan(0.5);
  });
});

function emptyTrip() {
  return {
    totals: {
      distM: 0, durationS: 0, movingS: 0, workS: 0, waitS: 0, climbM: 0, descentM: 0, maxGradeDeg: 0, energyKWh: 0, solarKWh: 0,
      o2Kg: 0, waterL: 0, doseMSv: 0, minTempC: 0, maxTau: 0, arriveUtcMs: 0, minO2Frac: null, minBatteryFrac: null,
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
