import { describe, expect, it } from 'vitest';
import { flatGrid, haversineM, pathLengthM, slopedGrid, syntheticGrid } from '../terrain';
import type { Grid, HazardZone, LonLat, RouteRequest, RouteStyle, Scenario, Vehicle } from '../types';
import { lowerBoundS, routeOnGrid, segmentCost } from './core';
import type { CostField } from './core';
import { AIR_LANDING_SLOPE_DEG, STYLE_WEIGHTS, makeCost } from './cost';
import type { CostDeps, CostOptions } from './cost';

const DEG = Math.PI / 180;
const scenario: Scenario = { dust: 'clear', solarEvent: false, solarCycle: 0.5 };

function vehicle(over: Partial<Vehicle>): Vehicle {
  return {
    id: 'openRover',
    name: 'Test rover',
    blurb: '',
    kind: 'ground',
    crew: 2,
    flatSpeedMs: 2,
    comfortSlopeDeg: 10,
    blockSlopeDeg: 20,
    batteryKWh: 16,
    extenderKWh: 0,
    solarKW: 0,
    hotelW: 250,
    ecoHotelW: 150,
    massKg: 700,
    o2KgPerPerson: 0.9,
    scrubberH: 8,
    cabin: false,
    doseFactor: 1,
    needsDaylight: true,
    canCamp: false,
    eyeHeightM: 1.9,
    footprintM: [3, 2],
    ...over,
  };
}

const rover = vehicle({});
const robot = vehicle({ id: 'robotRover', crew: 0, o2KgPerPerson: 0, blockSlopeDeg: 30, comfortSlopeDeg: 15 });
const walker = vehicle({ id: 'foot', kind: 'walk', flatSpeedMs: 1, comfortSlopeDeg: 15, blockSlopeDeg: 25, batteryKWh: 0, massKg: 120 });
const heli = vehicle({ id: 'heli', kind: 'air', crew: 0, flatSpeedMs: 5, comfortSlopeDeg: 90, blockSlopeDeg: 90, batteryKWh: 0.036 });

/** Small stand-ins for the app's models: easy numbers, the same shapes. */
const fake: CostDeps = {
  // Full speed on the level, half at the blocking slope, nothing at or past it.
  speedMs: (v, gradeDeg) =>
    v.kind === 'air' ? v.flatSpeedMs : Math.abs(gradeDeg) >= v.blockSlopeDeg ? 0 : v.flatSpeedMs * (1 - 0.5 * (Math.abs(gradeDeg) / v.blockSlopeDeg)),
  // 250 W on the flat, 25 W more per degree up, 5 W less per degree down (to 200 W).
  walkingW: (_kmh, gradeDeg) => (gradeDeg >= 0 ? 250 + 25 * gradeDeg : Math.max(200, 250 + 5 * gradeDeg)),
  doseMSvPerSol: () => 0.6,
  temperatureC: () => -40,
  tauAt: () => 0.5,
};

function options(v: Vehicle, style: RouteStyle, hazards: HazardZone[] = []): CostOptions {
  return { vehicle: v, style, departUtcMs: 0, scenario, hazards };
}

function at(grid: Grid, row: number, col: number): LonLat {
  return [grid.lonOf(col), grid.latOf(row)];
}

function request(grid: Grid, from: [number, number], to: [number, number], hazards: HazardZone[] = []): RouteRequest {
  return {
    requestId: 3,
    from: at(grid, from[0], from[1]),
    to: at(grid, to[0], to[1]),
    vehicle: 'openRover',
    style: 'fastest',
    departUtcMs: 0,
    scenario,
    hazards,
  };
}

/** Index into the pace table for a slope along the way, in degrees. */
function paceAt(cost: CostField, gradeDeg: number): number {
  const last = cost.pace.length - 1;
  return cost.pace[Math.round(((Math.tan(gradeDeg * DEG) + cost.paceTanMax) * last) / (2 * cost.paceTanMax))] as number;
}

describe('makeCost on level ground', () => {
  const grid = flatGrid(60, 60, 20);

  it('costs travel time at the flat speed, whatever the style', () => {
    for (const style of ['safest', 'fastest', 'eco'] as const) {
      for (const v of [rover, walker, heli, robot]) {
        const cost = makeCost(grid, options(v, style), fake);
        const a = 10 * 60 + 5;
        const b = 40 * 60 + 50;
        const metres = Math.hypot(30, 45) * ((grid.cellM(10) + grid.cellM(40)) / 2);
        expect(segmentCost(cost, a, b)).toBeCloseTo(metres / v.flatSpeedMs, 4);
        // On level ground the search's lower bound is the cost itself.
        expect(lowerBoundS(cost, a, b)).toBeCloseTo(metres / v.flatSpeedMs, 4);
        expect(cost.blocked.every((x) => x === 0)).toBe(true);
        expect(cost.endBlock(a)).toBeNull();
        expect(cost.mult?.every((m) => m === 1)).toBe(true);
      }
    }
  });

  it('charges turns by style, in cells of travel, and none in the air', () => {
    const safest = makeCost(grid, options(rover, 'safest'), fake);
    const fastest = makeCost(grid, options(rover, 'fastest'), fake);
    expect(safest.turnSPerRad).toBeCloseTo((STYLE_WEIGHTS.safest.turn * grid.cellWidthM) / rover.flatSpeedMs, 9);
    expect(fastest.turnSPerRad).toBeLessThan(safest.turnSPerRad);
    expect(makeCost(grid, options(heli, 'safest'), fake).turnSPerRad).toBe(0);
  });

  it('takes a vehicle by its id and uses the app models by default', () => {
    const cost = makeCost(grid, { vehicle: 'foot', style: 'fastest', departUtcMs: Date.UTC(2031, 0, 1), scenario, hazards: [] });
    const metres = 40 * grid.cellM(10);
    expect(segmentCost(cost, 10 * 60 + 5, 10 * 60 + 45)).toBeCloseTo((metres * 3.6) / 3.3, 3);
    expect(cost.words.vehicle).toBe('a walker');
    // Eco on foot weighs each second by walkingW / 250: on the flat that is close to 1.
    const eco = makeCost(grid, { vehicle: 'foot', style: 'eco', departUtcMs: Date.UTC(2031, 0, 1), scenario, hazards: [] });
    const ratio = segmentCost(eco, 10 * 60 + 5, 10 * 60 + 45) / segmentCost(cost, 10 * 60 + 5, 10 * 60 + 45);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.1);
  });
});

describe('slope', () => {
  it('blocks cells steeper than the blocking slope and says how steep', () => {
    // Level, then a 30 degree ramp over columns 30 to 39, then level again.
    const rise = Math.tan(30 * DEG) * 20;
    const grid = syntheticGrid(40, 70, 20, (_r, c) => Math.min(Math.max(c - 30, 0), 10) * rise);
    const cost = makeCost(grid, options(rover, 'fastest'), fake);
    expect(cost.blocked[20 * 70 + 35]).toBe(1);
    expect(cost.blocked[20 * 70 + 10]).toBe(0);
    expect(cost.blocked[20 * 70 + 60]).toBe(0);
    const block = cost.endBlock(20 * 70 + 35);
    expect(block?.kind).toBe('steep');
    expect(block && block.kind === 'steep' ? block.slopeDeg : 0).toBeCloseTo(30, 0);
    expect(segmentCost(cost, 20 * 70 + 10, 20 * 70 + 60)).toBe(Infinity);
    // The robot's limit is 30 degrees with these numbers: the ramp is right at it, so make it gentler.
    const gentle = syntheticGrid(40, 70, 20, (_r, c) => Math.min(Math.max(c - 30, 0), 10) * Math.tan(24 * DEG) * 20);
    expect(makeCost(gentle, options(robot, 'fastest'), fake).blocked[20 * 70 + 35]).toBe(0);
    expect(makeCost(gentle, options(rover, 'fastest'), fake).blocked[20 * 70 + 35]).toBe(1);
  });

  it('slows travel by the slope along the way, not across it', () => {
    const grid = slopedGrid(50, 50, 20, 10, 'east');
    const cost = makeCost(grid, options(rover, 'fastest'), fake);
    const flat = makeCost(flatGrid(50, 50, 20), options(rover, 'fastest'), fake);
    const a = 25 * 50 + 10;
    const up = segmentCost(cost, a, 25 * 50 + 40);
    const down = segmentCost(cost, 25 * 50 + 40, a);
    const across = segmentCost(cost, 10 * 50 + 25, 40 * 50 + 25);
    const level = segmentCost(flat, a, 25 * 50 + 40);
    const mult = cost.mult?.[a] as number;
    expect(mult).toBeGreaterThan(1);
    expect(mult).toBeLessThan(1.3);
    // Speed at 10 degrees is 75% of flat speed with the fake model, up or down.
    expect(up / (level * mult)).toBeCloseTo(1 / 0.75, 2);
    expect(down).toBeCloseTo(up, 6);
    expect(across / (level * mult)).toBeCloseTo(1, 2);
  });

  it('adds a soft penalty for hugging steep ground, heaviest for the safest style', () => {
    // A 19 degree ramp: just inside the rover's 20 degree limit.
    const grid = slopedGrid(40, 40, 20, 19, 'east');
    const cell = 20 * 40 + 20;
    const mult = (style: RouteStyle): number => makeCost(grid, options(rover, style), fake).mult?.[cell] as number;
    expect(makeCost(grid, options(rover, 'safest'), fake).blocked[cell]).toBe(0);
    expect(mult('safest')).toBeGreaterThan(mult('eco'));
    expect(mult('eco')).toBeGreaterThan(mult('fastest'));
    expect(mult('fastest')).toBeGreaterThan(1.3);
    expect(mult('safest')).toBeGreaterThan(3);
    // On a slope the vehicle is comfortable with, only ruggedness is left.
    const easy = makeCost(slopedGrid(40, 40, 20, 5, 'east'), options(rover, 'safest'), fake).mult?.[cell] as number;
    expect(easy).toBeLessThan(1.5);
  });
});

describe('style weights', () => {
  it('are heaviest for the safest style and leave the fastest nearly bare', () => {
    for (const key of Object.keys(STYLE_WEIGHTS.safest) as (keyof typeof STYLE_WEIGHTS.safest)[]) {
      expect(STYLE_WEIGHTS.safest[key]).toBeGreaterThanOrEqual(STYLE_WEIGHTS.eco[key]);
      expect(STYLE_WEIGHTS.eco[key]).toBeGreaterThanOrEqual(STYLE_WEIGHTS.fastest[key]);
      expect(STYLE_WEIGHTS.fastest[key]).toBeGreaterThanOrEqual(0);
    }
    expect(STYLE_WEIGHTS.fastest.dose).toBe(0);
    expect(STYLE_WEIGHTS.fastest.basin).toBe(0);
  });

  it('eco on foot counts oxygen: each second weighs walkingW / 250, and the pace is not slowed', () => {
    const grid = flatGrid(20, 20, 20);
    const fastest = makeCost(grid, options(walker, 'fastest'), fake);
    const eco = makeCost(grid, options(walker, 'eco'), fake);
    expect(paceAt(eco, 0)).toBeCloseTo(paceAt(fastest, 0), 9);
    expect(paceAt(eco, 10) / paceAt(fastest, 10)).toBeCloseTo((250 + 25 * 10) / 250, 2);
    expect(paceAt(eco, -10) / paceAt(fastest, -10)).toBeCloseTo(200 / 250, 2);
    // The heuristic stays a lower bound: the cheapest second is a downhill one.
    expect(eco.minSecPerM).toBeLessThan(fastest.minSecPerM);
    // Safest on foot is plain time.
    expect(paceAt(makeCost(grid, options(walker, 'safest'), fake), 10)).toBeCloseTo(paceAt(fastest, 10), 9);
  });

  it('eco on wheels counts energy: climbs cost more than their time, descents less', () => {
    const grid = flatGrid(20, 20, 20);
    const fastest = makeCost(grid, options(rover, 'fastest'), fake);
    const eco = makeCost(grid, options(rover, 'eco'), fake);
    expect(paceAt(eco, 0)).toBeCloseTo(paceAt(fastest, 0), 6);
    expect(paceAt(eco, 8)).toBeGreaterThan(paceAt(fastest, 8) * 1.3);
    expect(paceAt(eco, -8)).toBeLessThan(paceAt(fastest, -8));
    expect(paceAt(eco, -8)).toBeGreaterThan(0);
    // The search's lower bound knows the climb: tight on the level, lower going down, higher going up.
    const ramp = slopedGrid(30, 60, 20, 6, 'east');
    const onRamp = makeCost(ramp, options(rover, 'eco'), fake);
    const west = 15 * 60 + 5;
    const east = 15 * 60 + 55;
    const up = segmentCost(onRamp, west, east);
    const down = segmentCost(onRamp, east, west);
    expect(up).toBeGreaterThan(down * 2);
    expect(lowerBoundS(onRamp, west, east)).toBeGreaterThan(lowerBoundS(onRamp, east, west) * 2);
    expect(lowerBoundS(onRamp, west, east)).toBeLessThanOrEqual(up * 1.03);
    expect(lowerBoundS(onRamp, west, east)).toBeGreaterThan(up * 0.5);
    expect(lowerBoundS(onRamp, east, west)).toBeLessThanOrEqual(down * 1.03);
    expect(lowerBoundS(eco, 5 * 20 + 2, 5 * 20 + 18)).toBeCloseTo(segmentCost(eco, 5 * 20 + 2, 5 * 20 + 18), 4);
  });

  it('weighs dust for the safest style, so it goes round a storm the fastest drives through', () => {
    const grid = flatGrid(80, 80, 50);
    // A dusty patch 1 km across in the middle of the grid.
    const centre = at(grid, 40, 40);
    const dusty: CostDeps = {
      ...fake,
      tauAt: (lat, lon) => (haversineM([lon, lat], centre) < 600 ? 3 : 0.5),
    };
    const safest = makeCost(grid, options(rover, 'safest'), dusty);
    const fastest = makeCost(grid, options(rover, 'fastest'), dusty);
    expect(safest.mult?.[40 * 80 + 40]).toBeCloseTo(1 + STYLE_WEIGHTS.safest.dust, 1);
    expect(fastest.mult?.[40 * 80 + 40]).toBeCloseTo(1 + STYLE_WEIGHTS.fastest.dust, 1);
    expect(safest.mult?.[5 * 80 + 5]).toBe(1);
    // Start and end 150 m outside the patch: going round is a long way for a short trip.
    const req = request(grid, [40, 25], [40, 55]);
    const around = routeOnGrid(req, grid, safest);
    const through = routeOnGrid(req, grid, fastest);
    if (!around?.ok || !through?.ok) throw new Error('no route');
    const closest = (path: readonly (readonly [number, number, number])[]): number =>
      Math.min(...path.map((p) => haversineM(p, centre)));
    expect(closest(through.path)).toBeLessThan(100);
    expect(closest(around.path)).toBeGreaterThan(300);
    expect(pathLengthM(around.path)).toBeGreaterThan(pathLengthM(through.path));
  });

  it('weighs radiation on high ground for a crew, not for a robot', () => {
    // Ground rising gently to the east; dose 30% higher at the top than at the bottom.
    const grid = slopedGrid(30, 60, 50, 3, 'east');
    const top = grid.heights[59] as number;
    const dosed: CostDeps = { ...fake, doseMSvPerSol: (elev, _t, _s, factor = 1) => 0.6 * (1 + 0.3 * (elev / top)) * factor };
    const crewed = makeCost(grid, options(rover, 'safest'), dosed).mult as Float32Array;
    const plain = makeCost(grid, options(rover, 'safest'), fake).mult as Float32Array;
    const robotic = makeCost(grid, options(robot, 'safest'), dosed).mult as Float32Array;
    const roboticPlain = makeCost(grid, options(robot, 'safest'), fake).mult as Float32Array;
    const low = 15 * 60 + 2;
    const high = 15 * 60 + 57;
    expect((crewed[low] as number) - (plain[low] as number)).toBeLessThan(0.15);
    expect((crewed[high] as number) - (plain[high] as number)).toBeCloseTo(STYLE_WEIGHTS.safest.dose, 1);
    expect(robotic[high]).toBeCloseTo(roboticPlain[high] as number, 6);
    const fast = makeCost(grid, options(rover, 'fastest'), dosed).mult as Float32Array;
    expect(fast[high]).toBeCloseTo(makeCost(grid, options(rover, 'fastest'), fake).mult?.[high] as number, 6);
  });

  it('weighs cold against the warmest ground on the grid', () => {
    const grid = flatGrid(40, 40, 50);
    const north = grid.latOf(0);
    const south = grid.latOf(39);
    // 30 degrees colder at the north edge than at the south edge.
    const chilly: CostDeps = { ...fake, temperatureC: (lat) => -40 - (30 * (lat - south)) / (north - south) };
    const mult = makeCost(grid, options(rover, 'safest'), chilly).mult as Float32Array;
    expect(mult[39 * 40 + 20]).toBeCloseTo(1, 2);
    expect(mult[20 * 40 + 20]).toBeCloseTo(1 + STYLE_WEIGHTS.safest.cold * (15 / 20), 1);
    expect(mult[0 * 40 + 20]).toBeCloseTo(1 + STYLE_WEIGHTS.safest.cold, 2);
    // Higher ground is colder by the model's own lapse rate.
    const lapse: CostDeps = { ...fake, temperatureC: (_lat, _lon, elev) => -40 - elev / 100 };
    const hill = syntheticGrid(40, 40, 50, (r, c) => (r > 15 && r < 25 && c > 15 && c < 25 ? 1000 : 0));
    const onHill = makeCost(hill, options(heli, 'safest'), lapse).mult as Float32Array;
    expect(onHill[20 * 40 + 20]).toBeCloseTo(1 + STYLE_WEIGHTS.safest.cold * (10 / 20), 2);
    expect(onHill[5 * 40 + 5]).toBeCloseTo(1, 5);
  });

  it('weighs a crater-floor basin: ground well below its surroundings', () => {
    // A bowl 1 km across and 80 m deep, with gentle walls, in a plain.
    const grid = syntheticGrid(120, 120, 50, (r, c) => {
      const d = Math.hypot(r - 60, c - 60) * 50;
      return d < 300 ? -80 : d < 500 ? -80 * (1 - (d - 300) / 200) ** 2 * (1 + (2 * (d - 300)) / 200) : 0;
    });
    const safest = makeCost(grid, options(robot, 'safest'), fake).mult as Float32Array;
    const eco = makeCost(grid, options(robot, 'eco'), fake).mult as Float32Array;
    const fastest = makeCost(grid, options(robot, 'fastest'), fake).mult as Float32Array;
    const floor = 60 * 120 + 60;
    const plain = 10 * 120 + 10;
    // The bowl floor lies about 70 m below the mean ground within 1.5 km: a full basin.
    expect(safest[floor]).toBeCloseTo(1 + STYLE_WEIGHTS.safest.basin, 2);
    expect(eco[floor]).toBeCloseTo(1 + STYLE_WEIGHTS.eco.basin, 2);
    expect(fastest[floor]).toBe(1);
    expect(safest[plain]).toBe(1);
    // The plain just outside the rim is above its neighbourhood mean: no basin there.
    expect(safest[60 * 120 + 75]).toBeLessThan(1.05);
  });

  it('keeps every multiplier at 1 or more, and the heuristic below every real cost', () => {
    const grid = syntheticGrid(60, 60, 30, (r, c) => 40 * Math.sin(r / 7) * Math.cos(c / 9) + c * 2);
    for (const style of ['safest', 'fastest', 'eco'] as const) {
      for (const v of [rover, walker]) {
        const cost = makeCost(grid, options(v, style), fake);
        expect((cost.mult as Float32Array).every((m) => m >= 1)).toBe(true);
        for (const [a, b] of [
          [5 * 60 + 5, 50 * 60 + 40],
          [30 * 60 + 2, 31 * 60 + 55],
          [55 * 60 + 55, 3 * 60 + 20],
        ] as const) {
          const s = segmentCost(cost, a, b);
          // The heights the cost walks are Horn-smoothed, so allow the bound a few percent.
          if (s < Infinity) expect(s).toBeGreaterThanOrEqual(lowerBoundS(cost, a, b) * 0.97);
        }
      }
    }
  });
});

describe('hazard zones', () => {
  const grid = flatGrid(100, 100, 20);
  const zone: HazardZone = { id: 'dd1', kind: 'dustDevil', lon: grid.lonOf(50), lat: grid.latOf(50), radiusM: 300 };

  it('are blocked cells, named when an end is inside one', () => {
    const cost = makeCost(grid, options(rover, 'fastest', [zone]), fake);
    expect(cost.blocked[50 * 100 + 50]).toBeGreaterThan(0);
    expect(cost.blocked[50 * 100 + 64]).toBeGreaterThan(0);
    expect(cost.blocked[50 * 100 + 66]).toBe(0);
    expect(cost.blocked[62 * 100 + 62]).toBe(0);
    expect(cost.endBlock(50 * 100 + 50)).toEqual({ kind: 'hazard', hazard: 'dustDevil' });
    let count = 0;
    for (const b of cost.blocked) if (b) count++;
    // Every cell that reaches into the zone: the disc and half a cell more.
    expect(count).toBeGreaterThanOrEqual(Math.PI * 15 * 15);
    expect(count).toBeLessThan(Math.PI * 16.5 * 16.5);
  });

  it('are avoided by the route', () => {
    const req = request(grid, [50, 10], [50, 90], [zone]);
    const reply = routeOnGrid(req, grid, makeCost(grid, options(rover, 'fastest', [zone]), fake));
    if (!reply?.ok) throw new Error('no route');
    for (const p of reply.path) expect(haversineM(p, [zone.lon, zone.lat])).toBeGreaterThan(300);
    expect(pathLengthM(reply.path)).toBeGreaterThan(haversineM(req.from, req.to) * 1.05);
    expect(pathLengthM(reply.path)).toBeLessThan(haversineM(req.from, req.to) * 1.2);
    // Without the zone the same request runs straight through its middle.
    const direct = routeOnGrid(req, grid, makeCost(grid, options(rover, 'fastest'), fake));
    if (!direct?.ok) throw new Error('no route');
    expect(Math.min(...direct.path.map((p) => haversineM(p, [zone.lon, zone.lat])))).toBeLessThan(20);
  });

  it('refuse a start inside one and point to the nearest clear ground', () => {
    const req = request(grid, [50, 45], [10, 10], [zone]);
    const reply = routeOnGrid(req, grid, makeCost(grid, options(rover, 'safest', [zone]), fake));
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedStart');
    expect(reply.message).toBe('The start point is inside a dust devil zone. The nearest clear spot is 220 m away.');
    expect(haversineM(reply.nearest as LonLat, [zone.lon, zone.lat])).toBeGreaterThan(300);
    expect(haversineM(reply.nearest as LonLat, req.from)).toBeLessThan(230);
  });

  it('cope with zones off the grid or with odd numbers', () => {
    const odd: HazardZone[] = [
      { id: 'far', kind: 'storm', lon: 10, lat: 10, radiusM: 500 },
      { id: 'nan', kind: 'keepOut', lon: Number.NaN, lat: 18, radiusM: 500 },
      { id: 'zero', kind: 'steep', lon: grid.lonOf(20.4), lat: grid.latOf(20.4), radiusM: 0 },
    ];
    const cost = makeCost(grid, options(rover, 'fastest', odd), fake);
    expect(cost.blocked.every((b) => b === 0)).toBe(true);
  });
});

describe('the helicopter', () => {
  // Level ground with a ridge 40 degrees steep on both sides running north to south.
  const rise = Math.tan(40 * DEG) * 20;
  const grid = syntheticGrid(60, 80, 20, (_r, c) => Math.max(0, 8 - Math.abs(c - 40)) * rise);

  it('flies over ground too steep to drive, at its own speed', () => {
    const drive = makeCost(grid, options(rover, 'fastest'), fake);
    const fly = makeCost(grid, options(heli, 'fastest'), fake);
    expect(drive.blocked[30 * 80 + 36]).toBe(1);
    expect(fly.blocked[30 * 80 + 36]).toBe(0);
    const req = request(grid, [30, 5], [30, 75]);
    expect(routeOnGrid(req, grid, drive)).toMatchObject({ ok: false, reason: 'noPath' });
    const reply = routeOnGrid(req, grid, fly);
    if (!reply?.ok) throw new Error('no route');
    expect(pathLengthM(reply.path) / haversineM(req.from, req.to)).toBeCloseTo(1, 3);
    expect(segmentCost(fly, 30 * 80 + 5, 30 * 80 + 75)).toBeCloseTo((70 * grid.cellM(30)) / 5, 4);
  });

  it('needs gentle ground at its ends', () => {
    const fly = makeCost(grid, options(heli, 'fastest'), fake);
    expect(AIR_LANDING_SLOPE_DEG).toBeLessThan(20);
    const reply = routeOnGrid(request(grid, [30, 5], [30, 36]), grid, fly);
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedEnd');
    expect(reply.message).toMatch(
      /^The end point is on ground steeper than the helicopter can land on \(40 degrees\)\. The nearest landing spot is \d+ m away\.$/,
    );
    const nearest = reply.nearest as LonLat;
    expect(fly.endBlock(Math.round(grid.rowOf(nearest[1])) * 80 + Math.round(grid.colOf(nearest[0])))).toBeNull();
  });

  it('is still kept out of hazard zones', () => {
    const zone: HazardZone = { id: 's', kind: 'storm', lon: grid.lonOf(20), lat: grid.latOf(30), radiusM: 200 };
    const fly = makeCost(grid, options(heli, 'fastest', [zone]), fake);
    const reply = routeOnGrid(request(grid, [30, 5], [30, 75], [zone]), grid, fly);
    if (!reply?.ok) throw new Error('no route');
    for (const p of reply.path) expect(haversineM(p, [zone.lon, zone.lat])).toBeGreaterThan(200);
  });
});

describe('blocked ends with the app vehicles', () => {
  it('says what is wrong and how far the nearest usable ground is', () => {
    // A 31 degree scarp across columns 40 to 49.
    const rise = Math.tan(31 * DEG) * 20;
    const grid = syntheticGrid(60, 90, 20, (_r, c) => Math.min(Math.max(c - 40, 0), 10) * rise);
    const req: RouteRequest = { ...request(grid, [30, 10], [30, 46]), vehicle: 'pressRover', style: 'safest' };
    const reply = routeOnGrid(req, grid, makeCost(grid, req));
    if (!reply || reply.ok) throw new Error('expected a failure');
    expect(reply.reason).toBe('blockedEnd');
    expect(reply.style).toBe('safest');
    expect(reply.message).toBe(
      'The end point is on ground steeper than the rover can climb (31 degrees). The nearest drivable spot is 80 m away.',
    );
    expect(Math.round(grid.colOf((reply.nearest as LonLat)[0]))).toBe(50);
    const walk = routeOnGrid({ ...req, vehicle: 'foot' }, grid, makeCost(grid, { ...req, vehicle: 'foot' }));
    expect(walk && !walk.ok ? walk.message : '').toMatch(/steeper than a walker can climb \(31 degrees\)\. The nearest walkable spot is/);
  });
});
