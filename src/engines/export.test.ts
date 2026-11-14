import { describe, expect, it } from 'vitest';
import { cuffLegs, exportMarks, missionCardHtml, toGeoJson, toGpx } from './export';
import type { ExportInput } from './export';
import { destination } from '../lib/geo';
import type { MissionPlan, PathPoint, TripResult, TripSample } from './types';

const NASTY = '<script>alert(1)</script> & "Rim"';
const DEPART = Date.UTC(2026, 10, 14, 12, 0, 0);

/** A path walked from a start along a list of [bearing, metres] legs, one point every `step` metres. */
function walk(lon: number, lat: number, legs: [bearing: number, m: number][], step = 50): PathPoint[] {
  const out: PathPoint[] = [[lon, lat, -2500]];
  let [x, y] = [lon, lat];
  let z = -2500;
  for (const [b, m] of legs) {
    for (let d = step; d <= m + 1e-6; d += step) {
      [x, y] = destination(x, y, b, step);
      z += 1;
      out.push([x, y, z]);
    }
  }
  return out;
}

function plan(over: Partial<MissionPlan> = {}): MissionPlan {
  return {
    start: { lon: 77.4, lat: 18.45, name: 'Three Forks' },
    stops: [{ id: 's1', lon: 77.41, lat: 18.45, name: NASTY, tasks: [{ id: 't1', kind: 'sample', minutes: 45 }] }],
    roundTrip: false,
    vehicle: 'foot',
    style: 'safest',
    campAtNight: false,
    ...over,
  };
}

function trip(path: PathPoint[]): TripResult {
  const samples: TripSample[] = path.map((p, i) => ({
    distM: i * 50,
    tS: i * 60,
    utcMs: DEPART + i * 60_000,
    elev: p[2],
    gradeDeg: 1,
    speedMs: 0.9,
    state: 'move',
    o2Kg: 1.8 - i * 0.001,
    batteryKWh: null,
    waterL: i * 0.01,
    doseMSv: i * 0.001,
    tempC: -40,
    tau: 0.5,
    sunElevDeg: 30,
  }));
  const last = samples[samples.length - 1];
  return {
    totals: {
      distM: last?.distM ?? 0,
      durationS: last?.tS ?? 0,
      movingS: last?.tS ?? 0,
      workS: 0,
      waitS: 0,
      climbM: 20,
      descentM: 0,
      maxGradeDeg: 3,
      energyKWh: 0,
      solarKWh: 0,
      o2Kg: 0.02,
      waterL: 0.2,
      doseMSv: 0.02,
      minTempC: -40,
      maxTau: 0.5,
      arriveUtcMs: last?.utcMs ?? DEPART,
      minO2Frac: 0.6,
      minBatteryFrac: null,
    },
    samples,
    warnings: [{ severity: 'caution', code: 'test', text: `Watch ${NASTY}` }],
    feasible: true,
    limitHit: null,
    pointOfNoReturnIndex: 5,
    o2OutIndex: null,
    walkbackIndex: 8,
    nightStops: [],
  };
}

function input(over: Partial<ExportInput> = {}): ExportInput {
  const path = walk(77.4, 18.45, [[90, 1000]]);
  return { name: NASTY, plan: plan(), path, stopIndices: [0, path.length - 1], trip: trip(path), departUtcMs: DEPART, ...over };
}

describe('escaping', () => {
  it('never lets a name break out of GPX', () => {
    const gpx = toGpx(input());
    expect(gpx).not.toContain('<script>');
    expect(gpx).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Rim&quot;');
    expect(gpx).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  });

  it('never lets a name or a warning break out of the cuff card', () => {
    const html = missionCardHtml(input());
    expect(html).not.toContain('<script');
    expect(html).toContain('Watch &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Rim&quot;');
  });
});

describe('toGpx', () => {
  it('is GPX 1.1 with the Mars frame, waypoints, elevation and times', () => {
    const gpx = toGpx(input());
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(gpx).toContain('version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain('MOLA areoid');
    expect(gpx).toContain('areocentric');
    expect(gpx).toContain('east longitude');
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(input().path.length);
    // Start and the stop (which is also the end of this one-way trip).
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(2);
    expect(gpx).toContain('<name>Three Forks</name>');
    expect(gpx).toContain('<ele>-2500.0</ele>');
    expect(gpx).toContain('<time>2026-11-14T12:00:00.000Z</time>');
  });

  it('works from the path alone, without a trip or stop indices', () => {
    const gpx = toGpx(input({ trip: null, stopIndices: [], departUtcMs: null, plan: plan({ roundTrip: true }) }));
    expect(gpx).not.toContain('<time>');
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(3);
    expect(gpx).toContain('<name>Back at Three Forks</name>');
  });

  it('handles an empty path', () => {
    expect(toGpx(input({ path: [], trip: null }))).toContain('<trkseg>');
  });
});

describe('exportMarks', () => {
  it('places a stop on the nearest path point when the router gave no indices', () => {
    const path = input().path;
    const marks = exportMarks(input({ stopIndices: [], plan: plan({ stops: [{ id: 's', lon: path[10]![0], lat: path[10]![1], tasks: [] }], roundTrip: true }) }));
    expect(marks.map((m) => m.kind)).toEqual(['start', 'stop', 'end']);
    expect(marks[1]?.index).toBe(10);
    expect(marks[1]?.name).toBe('Stop 1');
  });
});

describe('toGeoJson', () => {
  it('has the route with its budget, the ends and stops, and the safety marks', () => {
    const gj = toGeoJson(input());
    expect(gj.type).toBe('FeatureCollection');
    const route = gj.features[0];
    expect(route?.geometry.type).toBe('LineString');
    expect(route?.properties.durationS).toBe(trip(input().path).totals.durationS);
    expect(route?.properties.lengthM).toBeGreaterThan(990);
    const kinds = gj.features.map((f) => f.properties.kind);
    expect(kinds).toEqual(['route', 'start', 'stop', 'pointOfNoReturn', 'walkbackLimit']);
    expect(gj.features[2]?.properties.name).toBe(NASTY);
    expect(gj.features[2]?.properties.arriveLtst).toMatch(/^\d\d:\d\d$/);
    expect(gj.frame).toContain('MOLA');
    expect(() => JSON.stringify(gj)).not.toThrow();
  });

  it('works without a trip', () => {
    const gj = toGeoJson(input({ trip: null }));
    expect(gj.features.map((f) => f.properties.kind)).toEqual(['route', 'start', 'stop']);
  });
});

describe('cuffLegs', () => {
  it('cuts a straight path every 2 km', () => {
    const path = walk(77.4, 18.45, [[0, 5000]]);
    const legs = cuffLegs(path);
    expect(legs.map((l) => Math.round(l.distM / 50) * 50)).toEqual([2000, 2000, 1000]);
    for (const l of legs) expect(l.headingDeg).toBeCloseTo(0, 0);
    expect(legs[0]?.climbM).toBeCloseTo(40, 0);
    expect(legs[0]?.arriveLtstH).toBeNull();
  });

  it('cuts at a turn of 30 degrees or more, but not at a gentle one', () => {
    const sharp = cuffLegs(walk(77.4, 18.45, [[90, 1000], [135, 1000]]));
    expect(sharp).toHaveLength(2);
    expect(sharp[0]?.headingDeg).toBeCloseTo(90, 0);
    expect(sharp[1]?.headingDeg).toBeCloseTo(135, 0);
    const gentle = cuffLegs(walk(77.4, 18.45, [[90, 800], [110, 800]]));
    expect(gentle).toHaveLength(1);
  });

  it('ignores the zigzag of grid-stepped paths', () => {
    // Alternate east and north-east every cell, as a router on a grid does: the course is about 67 degrees.
    const zig = walk(77.4, 18.45, Array.from({ length: 30 }, (_, i): [number, number] => [i % 2 ? 45 : 90, 50]));
    expect(cuffLegs(zig)).toHaveLength(1);
  });

  it('gives arrival LTST when times are known, and ends a leg at every stop', () => {
    const path = walk(77.4, 18.45, [[90, 1000]]);
    const t = trip(path).samples.map((s) => s.utcMs);
    const legs = cuffLegs(path, { utcMs: t, stopIndices: [10] });
    expect(legs).toHaveLength(2);
    expect(legs[0]?.toIndex).toBe(10);
    expect(legs[0]?.arriveUtcMs).toBe(t[10]);
    expect(legs[0]?.arriveLtstH).toBeGreaterThanOrEqual(0);
    expect(legs[0]?.arriveLtstH).toBeLessThan(24);
  });

  it('copes with tiny paths', () => {
    expect(cuffLegs([])).toEqual([]);
    expect(cuffLegs([[77, 18, 0]])).toEqual([]);
  });
});

describe('missionCardHtml', () => {
  it('is a self-contained A5 page with budget, marks, warnings and legs', () => {
    const html = missionCardHtml(input());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('size: A5');
    expect(html).not.toMatch(/<script|<link|src=|href=|@import|url\(/i);
    for (const h of ['Budget', 'Marks', 'Warnings', 'Legs']) expect(html).toContain(`<h2>${h}</h2>`);
    expect(html).toContain('Point of no return');
    expect(html).toContain('Walk-home limit');
    expect(html).toContain('LTST');
  });

  it('works without a trip', () => {
    const html = missionCardHtml(input({ trip: null, departUtcMs: null }));
    expect(html).toContain('not computed');
    expect(html).not.toContain('<h2>Warnings</h2>');
    expect(html).toContain('<h2>Legs</h2>');
  });
});
