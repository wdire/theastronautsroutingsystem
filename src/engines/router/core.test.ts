import { describe, expect, it } from 'vitest';
import { flatGrid, haversineM, pathLengthM } from '../terrain';
import type { Grid, LonLat, PathPoint, RouteReply, RouteRequest, Scenario } from '../types';
import {
  MinHeap,
  lazyThetaStar,
  nearestOpenCell,
  pathFromCells,
  routeOnGrid,
  routeOnGridAsync,
  segmentCost,
  uniformCost,
} from './core';
import type { CostField } from './core';

const scenario: Scenario = { dust: 'clear', solarEvent: false, solarCycle: 0.5 };

function at(grid: Grid, row: number, col: number): LonLat {
  return [grid.lonOf(col), grid.latOf(row)];
}

function request(grid: Grid, from: [number, number], to: [number, number], id = 1): RouteRequest {
  return {
    requestId: id,
    from: at(grid, from[0], from[1]),
    to: at(grid, to[0], to[1]),
    vehicle: 'openRover',
    style: 'fastest',
    departUtcMs: 0,
    scenario,
    hazards: [],
  };
}

/** A blocked wall along one column, from row r0 to row r1 inclusive. */
function wall(grid: Grid, col: number, r0: number, r1: number, thickness = 1): Uint8Array {
  const blocked = new Uint8Array(grid.rows * grid.cols);
  for (let r = r0; r <= r1; r++) for (let t = 0; t < thickness; t++) blocked[r * grid.cols + col + t] = 1;
  return blocked;
}

function okPath(reply: RouteReply | null): PathPoint[] {
  if (!reply || !reply.ok) throw new Error(`expected a route, got ${JSON.stringify(reply)}`);
  return reply.path;
}

/** Largest distance of any point from the straight line between the ends, in metres. */
function maxOffLineM(path: PathPoint[]): number {
  const a = path[0];
  const b = path[path.length - 1];
  if (!a || !b) return 0;
  const k = Math.cos((a[1] * Math.PI) / 180);
  const bx = (b[0] - a[0]) * k;
  const by = b[1] - a[1];
  const len = Math.hypot(bx, by);
  let worst = 0;
  for (const p of path) {
    const px = (p[0] - a[0]) * k;
    const py = p[1] - a[1];
    worst = Math.max(worst, Math.abs(px * by - py * bx) / len);
  }
  return ((worst * Math.PI) / 180) * 3_396_190;
}

describe('MinHeap', () => {
  it('pops ids in order of their keys', () => {
    const heap = new MinHeap(2);
    const keys = [5.5, 1.25, 9, 3, 3.0000001, 0.5, 7, 2];
    keys.forEach((k, i) => heap.push(i, k));
    const out: number[] = [];
    while (heap.size > 0) {
      heap.pop();
      out.push(heap.lastKey);
    }
    expect(out).toEqual([...keys].sort((x, y) => x - y));
    expect(heap.pop()).toBe(-1);
  });
});

describe('segmentCost', () => {
  const grid = flatGrid(40, 40, 10);

  it('is distance over speed on open ground', () => {
    const f = uniformCost(grid, { speedMs: 2 });
    const a = 5 * 40 + 5;
    expect(segmentCost(f, a, a)).toBe(0);
    expect(segmentCost(f, a, 5 * 40 + 25)).toBeCloseTo((20 * grid.cellM(5)) / 2, 6);
    const diag = segmentCost(f, a, 17 * 40 + 14);
    expect(diag).toBeCloseTo((Math.hypot(12, 9) * ((grid.cellM(5) + grid.cellM(17)) / 2)) / 2, 6);
    expect(segmentCost(f, 17 * 40 + 14, a)).toBeCloseTo(diag, 9);
  });

  it('is cut by a blocked cell anywhere on the line, however thin the wall', () => {
    const f = uniformCost(grid, { blocked: wall(grid, 20, 0, 39) });
    for (const [r0, r1] of [
      [5, 5],
      [5, 30],
      [38, 2],
      [10, 11],
    ] as const) {
      expect(segmentCost(f, r0 * 40 + 3, r1 * 40 + 36)).toBe(Infinity);
    }
    expect(segmentCost(f, 5 * 40 + 3, 30 * 40 + 19)).toBeLessThan(Infinity);
  });

  it('does not slip through the corner between two blocked cells', () => {
    const blocked = new Uint8Array(40 * 40);
    blocked[10 * 40 + 11] = 1;
    blocked[11 * 40 + 10] = 1;
    const f = uniformCost(grid, { blocked });
    expect(segmentCost(f, 10 * 40 + 10, 11 * 40 + 11)).toBe(Infinity);
    expect(segmentCost(f, 8 * 40 + 8, 14 * 40 + 14)).toBe(Infinity);
    // A diagonal wall one cell thick cannot be crossed either.
    const diagonal = new Uint8Array(40 * 40);
    for (let i = 0; i < 40; i++) diagonal[i * 40 + i] = 1;
    const g = uniformCost(grid, { blocked: diagonal });
    expect(segmentCost(g, 20 * 40 + 5, 5 * 40 + 20)).toBe(Infinity);
    expect(segmentCost(g, 20 * 40 + 19, 19 * 40 + 20)).toBe(Infinity);
  });

  it('weighs each cell by its multiplier and by the slope along the way', () => {
    const base = uniformCost(grid);
    const mult = new Float32Array(40 * 40).fill(1);
    for (let r = 0; r < 40; r++) mult[r * 40 + 10] = 3;
    const heavy: CostField = { ...base, mult };
    const a = 5 * 40 + 5;
    const b = 5 * 40 + 15;
    expect(segmentCost(heavy, a, b)).toBeCloseTo(segmentCost(base, a, b) + 2 * grid.cellM(5), 6);

    // Ground rising to the east at 0.2: slow uphill, quick downhill, level across.
    const gradE = new Float32Array(40 * 40).fill(0.2);
    const gradN = new Float32Array(40 * 40);
    const pace = new Float64Array(201);
    for (let i = 0; i <= 200; i++) pace[i] = 1 + Math.max(0, (i - 100) / 100) * 5; // 1 s/m level, dearer uphill
    const sloped: CostField = { ...base, gradE, gradN, pace, paceTanMax: 1 };
    const east = segmentCost(sloped, a, b);
    const west = segmentCost(sloped, b, a);
    const south = segmentCost(sloped, a, 15 * 40 + 5);
    expect(east).toBeCloseTo(2 * west, 6);
    expect(south).toBeCloseTo(west, 1);
    const cliff: CostField = { ...sloped, pace: pace.map((v, i) => (i > 110 ? Infinity : v)) };
    expect(segmentCost(cliff, a, b)).toBe(Infinity);
    expect(segmentCost(cliff, b, a)).toBeLessThan(Infinity);
  });
});

describe('lazyThetaStar', () => {
  it('returns a straight line on flat ground', () => {
    const grid = flatGrid(120, 160, 10);
    const cost = uniformCost(grid);
    const start = 17 * 160 + 9;
    const goal = 101 * 160 + 143;
    const result = lazyThetaStar(grid, cost, start, goal);
    if (!result.ok) throw new Error(result.reason);
    expect(result.cells).toEqual([start, goal]);
    expect(result.costS).toBeCloseTo(segmentCost(cost, start, goal), 6);
  });

  it('joins its short lines into one straight run, however short they are kept', () => {
    const grid = flatGrid(300, 300, 10);
    const cost = uniformCost(grid);
    const start = 12 * 300 + 7;
    const goal = 291 * 300 + 288;
    for (const maxLineCells of [8, 64, 1e9]) {
      const result = lazyThetaStar(grid, cost, start, goal, undefined, { maxLineCells });
      if (!result.ok) throw new Error(result.reason);
      expect(result.cells).toEqual([start, goal]);
      expect(result.costS).toBeCloseTo(segmentCost(cost, start, goal), 6);
    }
  });

  it('routes a straight path within 1% of the straight distance', () => {
    const grid = flatGrid(120, 160, 10);
    const req = request(grid, [17, 9], [101, 143]);
    const path = okPath(routeOnGrid(req, grid, uniformCost(grid)));
    const straight = haversineM(req.from, req.to);
    expect(pathLengthM(path) / straight).toBeGreaterThan(0.999);
    expect(pathLengthM(path) / straight).toBeLessThan(1.01);
    expect(maxOffLineM(path)).toBeLessThan(0.5);
    expect(path[0]?.slice(0, 2)).toEqual([...req.from]);
    expect(path[path.length - 1]?.slice(0, 2)).toEqual([...req.to]);
    expect(path.length).toBeGreaterThan(100);
    expect(path.every((p) => p[2] === 0)).toBe(true);
  });

  it('goes around a wall and never crosses it', () => {
    const grid = flatGrid(100, 100, 10);
    const blocked = wall(grid, 50, 10, 99, 2);
    const cost = uniformCost(grid, { blocked });
    const req = request(grid, [60, 10], [60, 90]);
    const reply = routeOnGrid(req, grid, cost);
    const path = okPath(reply);
    for (const p of path) {
      const cell = Math.round(grid.rowOf(p[1])) * 100 + Math.round(grid.colOf(p[0]));
      expect(blocked[cell]).toBe(0);
    }
    // It has to pass north of row 10, where the wall ends.
    const northmost = Math.min(...path.map((p) => grid.rowOf(p[1])));
    expect(northmost).toBeLessThan(10);
    expect(northmost).toBeGreaterThan(7);
    // And it is close to the shortest way round: two straight legs over the wall's end.
    const tight = (Math.hypot(51, 40) + Math.hypot(51, 40)) * grid.cellWidthM;
    expect(pathLengthM(path)).toBeGreaterThan(haversineM(req.from, req.to) * 1.2);
    expect(pathLengthM(path)).toBeLessThan(tight * 1.03);
  });

  it('takes a detour when the straight line is dear', () => {
    const grid = flatGrid(60, 60, 10);
    const mult = new Float32Array(60 * 60).fill(1);
    for (let r = 10; r < 60; r++) for (let c = 25; c < 35; c++) mult[r * 60 + c] = 12;
    const cost: CostField = { ...uniformCost(grid), mult };
    const result = lazyThetaStar(grid, cost, 40 * 60 + 5, 40 * 60 + 55);
    if (!result.ok) throw new Error(result.reason);
    const direct = segmentCost(cost, 40 * 60 + 5, 40 * 60 + 55);
    expect(result.costS).toBeLessThan(direct * 0.9);
    expect(Math.min(...result.cells.map((c) => Math.floor(c / 60)))).toBeLessThan(10);
  });

  it('charges for turns when asked to', () => {
    const grid = flatGrid(60, 60, 10);
    const blocked = wall(grid, 30, 20, 59);
    const plain = lazyThetaStar(grid, uniformCost(grid, { blocked }), 40 * 60 + 5, 40 * 60 + 55);
    const turning = lazyThetaStar(grid, uniformCost(grid, { blocked, turnSPerRad: 50 }), 40 * 60 + 5, 40 * 60 + 55);
    if (!plain.ok || !turning.ok) throw new Error('no route');
    expect(turning.costS).toBeGreaterThan(plain.costS + 25);
  });

  it('is deterministic', () => {
    const grid = flatGrid(90, 90, 10);
    const blocked = wall(grid, 30, 0, 70);
    for (let r = 20; r < 90; r++) blocked[r * 90 + 60] = 1;
    const req = request(grid, [80, 5], [10, 85]);
    const a = routeOnGrid(req, grid, uniformCost(grid, { blocked }));
    const b = routeOnGrid(req, grid, uniformCost(grid, { blocked }));
    expect(a).toEqual(b);
    expect(okPath(a).length).toBeGreaterThan(2);
  });

  it('reports progress that only rises and ends at 1', () => {
    const grid = flatGrid(200, 200, 10);
    const blocked = wall(grid, 100, 20, 199);
    const seen: number[] = [];
    const result = lazyThetaStar(grid, uniformCost(grid, { blocked }), 150 * 200 + 10, 150 * 200 + 190, (f) => seen.push(f), {
      batch: 500,
    });
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] as number);
    expect(seen[0]).toBeGreaterThanOrEqual(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('stops at the expansion cap instead of running on', () => {
    const grid = flatGrid(200, 200, 10);
    const blocked = wall(grid, 100, 5, 199);
    const result = lazyThetaStar(grid, uniformCost(grid, { blocked }), 190 * 200 + 5, 190 * 200 + 195, undefined, {
      maxExpansions: 300,
    });
    expect(result).toEqual({ ok: false, reason: 'tooFar', expanded: 300 });
  });

  it('stops when cancelled between batches', () => {
    const grid = flatGrid(200, 200, 10);
    const blocked = wall(grid, 100, 5, 199);
    let asked = 0;
    const result = lazyThetaStar(grid, uniformCost(grid, { blocked }), 190 * 200 + 5, 190 * 200 + 195, undefined, {
      batch: 100,
      shouldCancel: () => ++asked >= 3,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('cancelled');
    expect(result.expanded).toBeLessThanOrEqual(300);
  });

  it('says there is no path when the goal is sealed off', () => {
    const grid = flatGrid(50, 50, 10);
    const blocked = wall(grid, 25, 0, 49);
    const result = lazyThetaStar(grid, uniformCost(grid, { blocked }), 10 * 50 + 5, 10 * 50 + 45);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('noPath');
  });
});

describe('routeOnGrid failures', () => {
  const grid = flatGrid(120, 120, 20);

  it('refuses an end outside the region, in words', () => {
    const req: RouteRequest = { ...request(grid, [10, 10], [50, 50]), to: [60, 18] };
    const reply = routeOnGrid(req, grid, uniformCost(grid));
    expect(reply).toMatchObject({ ok: false, reason: 'outsideRegion', requestId: 1, style: 'fastest' });
    expect(reply && !reply.ok ? reply.message : '').toMatch(/end point is outside the mapped region/);
    const nan = routeOnGrid({ ...req, to: [Number.NaN, 18] }, grid, uniformCost(grid));
    expect(nan).toMatchObject({ ok: false, reason: 'outsideRegion' });
  });

  it('refuses an end inside the region but off the grid', () => {
    const req: RouteRequest = { ...request(grid, [10, 10], [50, 50]), from: [grid.lonOf(-40), grid.latOf(10)] };
    const reply = routeOnGrid(req, grid, uniformCost(grid));
    expect(reply).toMatchObject({ ok: false, reason: 'outsideRegion' });
    expect(reply && !reply.ok ? reply.message : '').toMatch(/start point is outside the terrain loaded/);
  });

  it('names a blocked end and offers the nearest spot the vehicle can use', () => {
    const blocked = new Uint8Array(120 * 120);
    for (let r = 40; r <= 60; r++) for (let c = 70; c <= 90; c++) blocked[r * 120 + c] = 1;
    const steep: CostField = {
      ...uniformCost(grid, { blocked }),
      endBlock: (cell) => (blocked[cell] ? { kind: 'steep', slopeDeg: 31.2 } : null),
      words: { vehicle: 'the rover', climb: 'can climb', spot: 'drivable spot' },
    };
    const reply = routeOnGrid(request(grid, [10, 10], [50, 73]), grid, steep);
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedEnd');
    expect(reply.message).toBe(
      'The end point is on ground steeper than the rover can climb (31 degrees). The nearest drivable spot is 80 m away.',
    );
    expect(reply.nearest).toBeDefined();
    const nearest = reply.nearest as LonLat;
    expect(Math.round(grid.rowOf(nearest[1]))).toBe(50);
    expect(Math.round(grid.colOf(nearest[0]))).toBe(69);

    const startReply = routeOnGrid(request(grid, [41, 80], [10, 10]), grid, steep);
    if (!startReply || startReply.ok) throw new Error('expected a failure');
    expect(startReply.reason).toBe('blockedStart');
    expect(startReply.message).toMatch(/^The start point is on ground steeper than the rover can climb/);
    expect(Math.round(grid.rowOf((startReply.nearest as LonLat)[1]))).toBe(39);
  });

  it('names a hazard zone at an end', () => {
    const blocked = new Uint8Array(120 * 120);
    for (let r = 40; r <= 60; r++) for (let c = 70; c <= 90; c++) blocked[r * 120 + c] = 1;
    const cost: CostField = {
      ...uniformCost(grid, { blocked }),
      endBlock: (cell) => (blocked[cell] ? { kind: 'hazard', hazard: 'dustDevil' } : null),
    };
    const reply = routeOnGrid(request(grid, [10, 10], [50, 80]), grid, cost);
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedEnd');
    expect(reply.message).toBe('The end point is inside a dust devil zone. The nearest clear spot is 220 m away.');
  });

  it('gives no nearest point when nothing usable lies within 2 km', () => {
    const blocked = new Uint8Array(120 * 120).fill(1);
    blocked[0] = 0; // 2.4 km and more from the end
    blocked[1] = 0;
    const cost = uniformCost(grid, { blocked });
    const reply = routeOnGrid(request(grid, [0, 0], [119, 119]), grid, cost);
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedEnd');
    expect(reply.nearest).toBeUndefined();
    expect(reply.message).toMatch(/There is no clear spot within 2 km\.$/);
    expect(nearestOpenCell(grid, cost, 119 * 120 + 119, 1e6)?.cell).toBe(1);
  });

  it('answers at once when an end sits in a walled pocket', () => {
    const blocked = new Uint8Array(120 * 120);
    for (let i = 95; i <= 105; i++) {
      blocked[95 * 120 + i] = 1;
      blocked[105 * 120 + i] = 1;
      blocked[i * 120 + 95] = 1;
      blocked[i * 120 + 105] = 1;
    }
    const seen: number[] = [];
    const reply = routeOnGrid(request(grid, [5, 5], [100, 100]), grid, uniformCost(grid, { blocked }), {
      onProgress: (f) => seen.push(f),
    });
    expect(reply).toMatchObject({ ok: false, reason: 'noPath' });
    expect(reply && !reply.ok ? reply.message : '').toMatch(/no way through for the vehicle/);
    expect(seen).toEqual([]);
  });

  it('reports the cap as too far, in words', () => {
    const reply = routeOnGrid(request(grid, [5, 5], [110, 110]), grid, uniformCost(grid, { blocked: wall(grid, 60, 3, 119) }), {
      maxExpansions: 200,
    });
    expect(reply).toMatchObject({ ok: false, reason: 'tooFar' });
    expect(reply && !reply.ok ? reply.message : '').toMatch(/too far apart/);
  });

  it('returns a two-point path when both ends share a cell', () => {
    const req: RouteRequest = {
      ...request(grid, [10, 10], [10, 10]),
      to: [grid.lonOf(10.2), grid.latOf(10.1)],
    };
    const path = okPath(routeOnGrid(req, grid, uniformCost(grid)));
    expect(path.length).toBe(2);
    expect(path[1]?.[0]).toBe(req.to[0]);
  });

  it('returns null when cancelled', () => {
    const reply = routeOnGrid(request(grid, [5, 5], [110, 110]), grid, uniformCost(grid, { blocked: wall(grid, 60, 3, 119) }), {
      batch: 50,
      shouldCancel: () => true,
    });
    expect(reply).toBeNull();
  });
});

describe('routeOnGridAsync', () => {
  const grid = flatGrid(120, 120, 20);
  const cost = uniformCost(grid, { blocked: wall(grid, 60, 3, 119) });
  const req = request(grid, [100, 5], [100, 110], 7);

  it('gives the same reply as the plain search, pausing between batches', async () => {
    let pauses = 0;
    const seen: number[] = [];
    const reply = await routeOnGridAsync(req, grid, cost, {
      batch: 200,
      onProgress: (f) => seen.push(f),
      pause: async () => {
        pauses++;
      },
    });
    expect(reply).toEqual(routeOnGrid(req, grid, cost));
    expect(pauses).toBeGreaterThan(2);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('stops with null when cancelled during a pause', async () => {
    let cancelled = false;
    let pauses = 0;
    const reply = await routeOnGridAsync(req, grid, cost, {
      batch: 100,
      shouldCancel: () => cancelled,
      pause: async () => {
        if (++pauses === 2) cancelled = true;
      },
    });
    expect(reply).toBeNull();
    expect(pauses).toBe(2);
  });

  it('returns failures without searching', async () => {
    const reply = await routeOnGridAsync({ ...req, to: [10, 10] }, grid, cost, { pause: async () => {} });
    expect(reply).toMatchObject({ ok: false, reason: 'outsideRegion', requestId: 7 });
  });
});

describe('pathFromCells', () => {
  it('samples about every cell and reads heights from the grid', () => {
    const grid = flatGrid(50, 50, 10, 42);
    const path = pathFromCells(grid, [5 * 50 + 5, 5 * 50 + 25, 30 * 50 + 25]);
    expect(path.length).toBe(1 + 20 + 25);
    expect(path[20]?.[0]).toBeCloseTo(grid.lonOf(25), 9);
    expect(path[20]?.[1]).toBeCloseTo(grid.latOf(5), 9);
    expect(path.every((p) => p[2] === 42)).toBe(true);
  });
});
