import { describe, expect, it } from 'vitest';
import type { MissionPlan, PathPoint, Scenario, TripResult, TripSample, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { pathStats, shapeOnlyTrip } from '@/planner/geometry';
import { DEVIL_CLEARANCE_M, DUST_DEVIL_CHANCE, forceEvent, rngNext, scheduleEvents } from './events';
import { distanceM } from '@/lib/geo';
import type { World } from './types';
import { createWorld, crewAt, startMission, tick } from './world';

const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const LAT0 = 18.4;
const north = (m: number): PathPoint => [77.4, LAT0 + m / M_PER_DEG, -2500];
const PATH: PathPoint[] = Array.from({ length: 21 }, (_, i) => north(i * 100));
const DEPART = Date.UTC(2026, 10, 14, 6);

/** Straight 2 km, samples every 100 m, 30 minutes of work at 1 km. */
function trip(vehicle: VehicleId = 'foot'): TripResult {
  const v = VEHICLES[vehicle];
  const along = pathStats(PATH).along;
  let t = 0;
  const samples: TripSample[] = PATH.map((p, i) => {
    if (i > 0) t += ((along[i] ?? 0) - (along[i - 1] ?? 0)) / v.flatSpeedMs;
    if (i === 10) t += 1800;
    return {
      distM: along[i] ?? 0, tS: t, utcMs: 0, elev: p[2], gradeDeg: 0, speedMs: v.flatSpeedMs,
      state: i === 10 ? 'work' : 'move', o2Kg: 1.8 - (0.1 * t) / 3600, batteryKWh: null, waterL: 0,
      doseMSv: (0.002 * t) / 3600, tempC: -40, tau: 0.5, sunElevDeg: 30,
    };
  });
  const base = shapeOnlyTrip(PATH);
  return { ...base, samples, totals: { ...base.totals, durationS: t } };
}

function plan(vehicle: VehicleId = 'foot'): MissionPlan {
  const s = north(1000);
  return {
    start: { lon: PATH[0]![0], lat: PATH[0]![1], name: 'Base camp' },
    stops: [{ id: 's1', lon: s[0], lat: s[1], name: 'Delta front', tasks: [{ id: 't1', kind: 'sample', minutes: 30 }] }],
    roundTrip: false,
    vehicle,
    style: 'safest',
    campAtNight: false,
  };
}

function started(seed: number, scenario?: Scenario, vehicle: VehicleId = 'foot'): World {
  return startMission(
    createWorld(DEPART, seed),
    { name: 'Test', plan: plan(vehicle), path: PATH, stopIndices: [0, 10, 20], trip: trip(vehicle), ...(scenario ? { scenario } : {}) },
    DEPART,
  );
}

describe('seeded generator', () => {
  it('gives values in 0 to 1 and the same sequence for the same state', () => {
    let s = 99;
    const seen: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const [v, next] = rngNext(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.push(v);
      s = next;
    }
    expect(rngNext(99)).toEqual(rngNext(99));
    expect(new Set(seen).size).toBeGreaterThan(990);
  });
});

describe('scheduleEvents', () => {
  it('is deterministic for a seed', () => {
    const run = started(5).run!;
    expect(scheduleEvents(run, 1234)).toEqual(scheduleEvents(run, 1234));
  });

  it('puts at most one dust devil between 20% and 80% of the way out, 150 to 300 m in radius, clear of every stop and both ends', () => {
    let devils = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const run = started(seed).run!;
      const { events } = scheduleEvents(run, seed * 7919);
      const ds = events.filter((e) => e.kind === 'dustDevil');
      expect(ds.length).toBeLessThanOrEqual(1);
      const d = ds[0];
      if (!d) continue;
      devils++;
      const alongM = (d.lat! - LAT0) * M_PER_DEG;
      expect(alongM).toBeGreaterThanOrEqual(0.2 * 2000 - 1);
      expect(alongM).toBeLessThanOrEqual(0.8 * 2000 + 1);
      // A devil over a stop or an end could not be routed around.
      const keep = [run.home, ...run.legStops.map((ls) => run.path[ls.index]!), run.path[0]!, run.path[run.path.length - 1]!];
      for (const p of keep) expect(distanceM(p[0], p[1], d.lon!, d.lat!)).toBeGreaterThan(d.radiusM! + DEVIL_CLEARANCE_M - 1);
      expect(d.radiusM!).toBeGreaterThanOrEqual(150);
      expect(d.radiusM!).toBeLessThanOrEqual(300);
      expect(d.atUtcMs).toBeGreaterThanOrEqual(run.legStartUtcMs);
    }
    // Roughly the stated chance over 200 missions.
    expect(devils / 200).toBeGreaterThan(DUST_DEVIL_CHANCE - 0.15);
    expect(devils / 200).toBeLessThan(DUST_DEVIL_CHANCE + 0.15);
  });

  it('fires a scheduled dust devil as a caution that crosses the route ahead', () => {
    // Find a seed whose mission meets a devil, then play it.
    let seed = 1;
    while (!started(seed).scheduled.some((e) => e.kind === 'dustDevil')) seed++;
    const w = tick(started(seed), 2000);
    const a = w.alerts.find((x) => x.source === 'event' && x.id.startsWith('dust:'))!;
    expect(a.severity).toBe('caution');
    expect(a.action?.kind).toBe('reroute');
    expect(a.body).toMatch(/ahead and crosses the route/);
    expect(w.hazards.some((h) => h.id === a.hazardId && h.kind === 'dustDevil')).toBe(true);
  });

  it('adds a storm notice for a regional storm and nothing for clear skies', () => {
    const storm: Scenario = { dust: 'regionalStorm', storm: { lon: 79, lat: 20, radiusKm: 300 }, solarEvent: false, solarCycle: 0.5 };
    const w = tick(started(5, storm), 300);
    const a = w.alerts.find((x) => x.id.startsWith('storm:'))!;
    expect(a.severity).toBe('advisory');
    expect(a.action).toBeUndefined();
    expect(a.body).toMatch(/regional dust storm about 600\skm across/);
    expect(a.speak).toBeTruthy();
    expect(started(5).scheduled.some((e) => e.kind === 'storm' || e.kind === 'solar')).toBe(false);
  });

  it('warns of a solar particle event: shelter in a pressurised rover, turn back otherwise', () => {
    const solar: Scenario = { dust: 'clear', solarEvent: true, solarCycle: 0.5 };
    const onFoot = tick(started(5, solar), 4000).alerts.find((x) => x.id.startsWith('solar:'))!;
    expect(onFoot.severity).toBe('warning');
    expect(onFoot.action?.kind).toBe('turnBack');
    const rover = tick(started(5, solar, 'pressRover'), 4000).alerts.find((x) => x.id.startsWith('solar:'))!;
    expect(rover.severity).toBe('warning');
    expect(rover.action?.kind).toBe('shelter');
    expect(rover.body).toMatch(/\d\.\d\d mSv/);
  });
});

describe('forceEvent', () => {
  it('puts a dust devil on the route just ahead of the crew', () => {
    const w0 = tick(started(5), 300);
    const crew = crewAt(w0.run!, w0.utcMs);
    const w = forceEvent(w0, 'dustDevil');
    const added = w.alerts.filter((a) => !w0.alerts.includes(a));
    expect(added).toHaveLength(1);
    const a = added[0]!;
    expect(a.action?.kind).toBe('reroute');
    const h = w.hazards.find((x) => x.id === a.hazardId)!;
    const alongM = (h.lat - LAT0) * M_PER_DEG;
    expect(alongM).toBeGreaterThan(crew.distM);
    expect(alongM).toBeLessThanOrEqual(crew.distM + 601);
  });

  it('forces a storm and a particle event, and does nothing without a running mission', () => {
    const w = tick(started(5), 300);
    expect(forceEvent(w, 'storm').alerts.some((a) => a.id.startsWith('storm:forced:'))).toBe(true);
    expect(forceEvent(w, 'solar').alerts.some((a) => a.id.startsWith('solar:forced:') && a.severity === 'warning')).toBe(true);
    const idle = createWorld(DEPART);
    expect(forceEvent(idle, 'dustDevil')).toBe(idle);
  });
});
