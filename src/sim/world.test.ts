import { describe, expect, it } from 'vitest';
import { nextLtst } from '@/engines/marsTime';
import type { MissionPlan, PathPoint, TripResult, TripSample } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { distanceM } from '@/lib/geo';
import { pathStats, shapeOnlyTrip } from '@/planner/geometry';
import { forceEvent } from './events';
import type { World } from './types';
import {
  abortMission,
  adoptRoute,
  createWorld,
  crewAt,
  ignoreAlert,
  progress,
  proposal,
  say,
  setPaused,
  setSpeed,
  startMission,
  tick,
} from './world';

// One degree of latitude on Mars, m.
const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const LON = 77.4;
const LAT0 = 18.4;
const north = (m: number, eastM = 0): PathPoint => [
  LON + eastM / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
  LAT0 + m / M_PER_DEG,
  -2500,
];
const FOOT = VEHICLES.foot.flatSpeedMs;
const WORK_S = 30 * 60;
// A morning departure, so the walk ends long before sunset.
const DEPART = nextLtst(Date.UTC(2026, 10, 14), LON, 8.5);

function line(fromM: number, toM: number, stepM = 100): PathPoint[] {
  const out: PathPoint[] = [];
  const dir = toM >= fromM ? 1 : -1;
  for (let m = fromM; dir * (toM - m) >= -1e-9; m += dir * stepM) out.push(north(m));
  return out;
}

/** A hand-made trip: walks at the flat suit speed, holds where told, spends oxygen and dose at steady rates. */
function makeTrip(path: PathPoint[], holds: Record<number, number>, o2PerH = 0.1, o2Start = 1.8): TripResult {
  const along = pathStats(path).along;
  const samples: TripSample[] = [];
  let t = 0;
  path.forEach((p, i) => {
    if (i > 0) t += ((along[i] ?? 0) - (along[i - 1] ?? 0)) / FOOT;
    const hold = holds[i] ?? 0;
    t += hold;
    samples.push({
      distM: along[i] ?? 0,
      tS: t,
      utcMs: 0,
      elev: p[2],
      gradeDeg: 0,
      speedMs: FOOT,
      state: hold > 0 ? 'work' : 'move',
      o2Kg: Math.max(0, o2Start - (o2PerH * t) / 3600),
      batteryKWh: null,
      waterL: (0.2 * t) / 3600,
      doseMSv: (0.002 * t) / 3600,
      tempC: -40,
      tau: 0.5,
      sunElevDeg: 30,
    });
  });
  const base = shapeOnlyTrip(path);
  return { ...base, samples, totals: { ...base.totals, durationS: t } };
}

function plan(roundTrip = false): MissionPlan {
  const s = north(1000);
  const start = north(0);
  return {
    start: { lon: start[0], lat: start[1], name: 'Base camp' },
    stops: [{ id: 's1', lon: s[0], lat: s[1], name: 'Delta front', tasks: [{ id: 't1', kind: 'sample', minutes: 30 }] }],
    roundTrip,
    vehicle: 'foot',
    style: 'safest',
    campAtNight: false,
  };
}

const PATH = line(0, 2000);
const TRIP = makeTrip(PATH, { 10: WORK_S });
const DURATION_S = 2000 / FOOT + WORK_S;
const ARRIVE_STOP_S = 1000 / FOOT;

function started(trip: TripResult = TRIP, seed = 7): World {
  return startMission(
    createWorld(DEPART - 3_600_000, seed),
    { name: 'Delta walk', plan: plan(), path: PATH, stopIndices: [0, 10, 20], trip },
    DEPART,
  );
}

/** Advance at 1x in steps of one minute until a leg time. */
function until(world: World, legS: number): World {
  const run = world.run;
  if (!run) return world;
  const target = run.legStartUtcMs + legS * 1000;
  return tick(world, (target - world.utcMs) / 1000);
}

describe('mission playback', () => {
  it('puts the crew at the start at departure and at the end after the trip', () => {
    const w = started();
    expect(w.utcMs).toBe(DEPART);
    const run = w.run!;
    const c0 = crewAt(run, DEPART);
    expect(distanceM(c0.lon, c0.lat, PATH[0]![0], PATH[0]![1])).toBeLessThan(0.01);
    expect(c0.o2Kg).toBeCloseTo(1.8, 6);
    expect(c0.o2Frac).toBeCloseTo(1, 6);
    const end = crewAt(run, DEPART + DURATION_S * 1000);
    expect(distanceM(end.lon, end.lat, PATH[20]![0], PATH[20]![1])).toBeLessThan(0.01);
    expect(end.distM).toBeCloseTo(2000, 0);

    const done = tick(w, DURATION_S + 120);
    expect(done.run?.status).toBe('done');
    expect(done.run?.outcome?.kind).toBe('arrived');
    expect(done.run?.outcome?.tasksDone).toBe(1);
    expect(done.run?.outcome?.text).toMatch(/Arrived at Delta front after/);
    expect(done.utcMs).toBeCloseTo(DEPART + (DURATION_S + 120) * 1000, -1);
  });

  it('holds still at a work stop while time passes, and works the task todo, doing, done', () => {
    let w = started();
    w = until(w, ARRIVE_STOP_S - 120);
    expect(w.run?.tasks[0]?.state).toBe('todo');
    w = until(w, ARRIVE_STOP_S + 300);
    expect(w.run?.tasks[0]?.state).toBe('doing');
    const a = crewAt(w.run!, w.utcMs);
    expect(a.state).toBe('work');
    expect(a.speedMs).toBe(0);
    w = until(w, ARRIVE_STOP_S + 1200);
    const b = crewAt(w.run!, w.utcMs);
    expect(b.lat).toBe(a.lat);
    expect(b.distM).toBe(a.distM);
    expect(b.o2Kg!).toBeLessThan(a.o2Kg!);
    expect(w.run?.tasks[0]?.state).toBe('doing');
    w = until(w, ARRIVE_STOP_S + WORK_S + 60);
    expect(w.run?.tasks[0]?.state).toBe('done');
    expect(crewAt(w.run!, w.utcMs).state).toBe('move');
    expect(w.messages.some((m) => m.text.startsWith('Arrived at Delta front'))).toBe(true);
    expect(w.messages.some((m) => m.text.startsWith('Work at Delta front finished: 1 of 1 done'))).toBe(true);
  });

  it('moves along the path between samples at the trip speed', () => {
    const w = started();
    const c = crewAt(w.run!, DEPART + 500_000);
    expect(c.state).toBe('move');
    expect(c.distM).toBeCloseTo(500 * FOOT, 3);
    expect(c.speedMs).toBeCloseTo(FOOT, 6);
    expect(c.headingDeg).toBeCloseTo(0, 3);
  });

  it('never skips a task or an event at speed 100 with a large real step', () => {
    const w0 = startMission(
      createWorld(DEPART, 3),
      {
        name: 'Delta walk',
        plan: plan(),
        path: PATH,
        stopIndices: [0, 10, 20],
        trip: TRIP,
        scenario: { dust: 'clear', solarEvent: true, solarCycle: 0.5 },
      },
      DEPART,
    );
    expect(w0.scheduled.some((e) => e.kind === 'solar')).toBe(true);
    const w = tick(setSpeed(w0, 100), 3600);
    expect(w.run?.status).toBe('done');
    expect(w.run?.tasks.every((t) => t.state === 'done')).toBe(true);
    expect(w.alerts.filter((a) => a.id.startsWith('solar:'))).toHaveLength(1);
    expect(w.scheduled).toHaveLength(0);
  });

  it('never runs the clock backwards, and ignores bad steps and pauses', () => {
    const w = started();
    expect(tick(w, -10)).toBe(w);
    expect(tick(w, Number.NaN)).toBe(w);
    expect(tick(w, 0)).toBe(w);
    expect(tick(w, Infinity)).toBe(w);
    expect(tick(setPaused(w, true), 100)).toEqual(setPaused(w, true));
    let last = w.utcMs;
    let x = setSpeed(w, 20);
    for (const s of [0.016, 3, 0.5, -1, 40, 0.001]) {
      x = tick(x, s);
      expect(x.utcMs).toBeGreaterThanOrEqual(last);
      last = x.utcMs;
    }
    expect(setSpeed(w, 7 as never)).toBe(w);
  });

  it('completes a mission whose trip has no samples, at the flat speed with null consumables', () => {
    const w = started(shapeOnlyTrip(PATH));
    const c = crewAt(w.run!, DEPART + 600_000);
    expect(c.o2Kg).toBeNull();
    expect(c.o2Frac).toBeNull();
    expect(c.distM).toBeCloseTo(600 * FOOT, 3);
    const mid = until(w, ARRIVE_STOP_S + 600);
    expect(mid.run?.tasks[0]?.state).toBe('doing');
    const done = tick(setSpeed(w, 100), 100);
    expect(done.run?.status).toBe('done');
    expect(done.run?.outcome?.kind).toBe('arrived');
    expect(done.run?.outcome?.durationS).toBeCloseTo(DURATION_S, 0);
    expect(done.run?.tasks[0]?.state).toBe('done');
  });

  it('ends a round trip at the start with outcome home', () => {
    const path = [...line(0, 1000), ...line(1000, 0).slice(1)];
    const trip = makeTrip(path, { 10: WORK_S });
    let w = startMission(createWorld(DEPART), { name: 'Out and back', plan: plan(true), path, stopIndices: [0, 10, 20], trip }, DEPART);
    w = tick(setSpeed(w, 100), 60);
    const run = w.run!;
    expect(run.status).toBe('done');
    expect(run.outcome?.kind).toBe('home');
    expect(run.outcome?.text).toMatch(/^Back at Base camp after/);
    const c = crewAt(run, w.utcMs);
    expect(distanceM(c.lon, c.lat, path[0]![0], path[0]![1])).toBeLessThan(0.01);
    expect(c.state).toBe('done');
  });

  it('reports progress: share done, the next stop and the tasks', () => {
    const w = started();
    const p = progress(w.run!, DEPART + 300_000);
    expect(p.nextName).toBe('Delta front');
    expect(p.nextDistM).toBeCloseTo(1000 - 300 * FOOT, 0);
    expect(p.nextS).toBeCloseTo(ARRIVE_STOP_S - 300, 0);
    expect(p.tasksDone).toBe(0);
    expect(p.tasksTotal).toBe(1);
    expect(p.fraction).toBeCloseTo(300 / DURATION_S, 4);
    const late = progress(w.run!, DEPART + (ARRIVE_STOP_S + WORK_S + 100) * 1000);
    expect(late.nextName).toBe('Delta front');
    expect(late.nextDistM).toBeCloseTo(1000 - 100 * FOOT, 0);
  });

  it('aborts with remaining tasks skipped', () => {
    const w = abortMission(until(started(), 200));
    expect(w.run?.status).toBe('aborted');
    expect(w.run?.outcome?.kind).toBe('aborted');
    expect(w.run?.tasks[0]?.state).toBe('skipped');
    const frozen = crewAt(w.run!, w.utcMs + 3_600_000);
    expect(frozen.distM).toBeCloseTo(200 * FOOT, 3);
  });
});

describe('route changes', () => {
  it('reroutes around a forced dust devil with continuous consumables', () => {
    let w = until(started(), 600 / FOOT);
    w = forceEvent(w, 'dustDevil');
    const devils = w.alerts.filter((a) => a.id.startsWith('dust:forced:'));
    expect(devils).toHaveLength(1);
    const alert = devils[0]!;
    expect(alert.severity).toBe('caution');
    expect(alert.action?.kind).toBe('reroute');
    expect(alert.speak).toBeTruthy();
    const hazard = w.hazards.find((h) => h.id === alert.hazardId);
    expect(hazard?.kind).toBe('dustDevil');
    expect(hazard!.radiusM).toBeGreaterThanOrEqual(150);
    expect(hazard!.radiusM).toBeLessThanOrEqual(300);

    const p = proposal(w, alert.id)!;
    expect(p).not.toBeNull();
    const crew = crewAt(w.run!, w.utcMs);
    expect(p.from[0]).toBeCloseTo(crew.lon, 9);
    expect(p.from[1]).toBeCloseTo(crew.lat, 9);
    expect(crew.distM).toBeCloseTo(600, 0);
    expect(p.via).toHaveLength(2);
    expect(p.via[0]?.stopId).toBe('s1');
    expect(p.via[0]?.name).toBe('Delta front');
    expect(distanceM(p.via[1]!.lon, p.via[1]!.lat, PATH[20]![0], PATH[20]![1])).toBeLessThan(1);
    // The forced devil is routed around; one already over the crew or a stop would only block the router.
    expect(p.hazards.map((h) => h.id)).toContain(hazard!.id);

    // The router's answer, made by hand: on to the stop, then a 400 m dog-leg east around the devil.
    const path: PathPoint[] = [[crew.lon, crew.lat, crew.elev], ...line(700, 1000)];
    for (let m = 1000; m <= 2000; m += 100) path.push(north(m, 400));
    path.push(north(2000));
    const stopIdx = 4;
    const trip = makeTrip(path, { [stopIdx]: WORK_S });
    const before = crewAt(w.run!, w.utcMs);
    const w2 = adoptRoute(w, alert.id, { path, stopIndices: [0, stopIdx, path.length - 1], trip });
    const after = crewAt(w2.run!, w2.utcMs);
    expect(after.o2Kg!).toBeCloseTo(before.o2Kg!, 9);
    expect(after.o2Frac!).toBeCloseTo(before.o2Frac!, 9);
    expect(after.doseMSv).toBeCloseTo(before.doseMSv, 12);
    expect(w2.run?.carry.distM).toBeCloseTo(600, 0);
    expect(w2.alerts.find((a) => a.id === alert.id)?.resolved).toBe('applied');
    const msg = w2.messages[w2.messages.length - 1]!;
    expect(msg.from).toBe('system');
    expect(msg.text).toMatch(/^New route around the dust devil: .+ longer, .+ more\.$/);

    // A minute on, oxygen has gone on falling from where it was, not from a fresh tank.
    const w3 = tick(w2, 60);
    const c3 = crewAt(w3.run!, w3.utcMs);
    expect(c3.o2Kg!).toBeLessThan(after.o2Kg!);
    expect(after.o2Kg! - c3.o2Kg!).toBeCloseTo((0.1 * 60) / 3600, 6);
    expect(c3.doseMSv).toBeGreaterThan(after.doseMSv);

    const done = tick(setSpeed(w3, 100), 100);
    expect(done.run?.status).toBe('done');
    expect(done.run?.tasks[0]?.state).toBe('done');
    expect(done.run?.outcome?.distM).toBeCloseTo(600 + pathStats(path).distM, 0);
    expect(proposal(done, alert.id)).toBeNull();
  });

  it('turns back for home, dropping the stops ahead', () => {
    // Oxygen runs out fast on this trip, so the reserve warning comes early.
    let w = until(started(makeTrip(PATH, { 10: WORK_S }, 15)), 360);
    const reserve = w.alerts.find((a) => a.id === 'o2:reserve');
    expect(reserve?.action?.kind).toBe('turnBack');
    const p = proposal(w, reserve!.id)!;
    expect(p.via).toHaveLength(1);
    expect(p.via[0]?.name).toBe('Base camp');
    expect(p.homeIsAhead).toBe(true);
    const crew = crewAt(w.run!, w.utcMs);
    const back: PathPoint[] = [[crew.lon, crew.lat, crew.elev], ...line(300, 0)];
    w = adoptRoute(w, reserve!.id, { path: back, stopIndices: [0, back.length - 1], trip: makeTrip(back, {}, 0.5) });
    expect(w.run?.tasks[0]?.state).toBe('skipped');
    expect(w.messages.at(-1)?.text).toMatch(/^Turning back for Base camp: .+ to go/);
    w = tick(setSpeed(w, 100), 60);
    expect(w.run?.outcome?.kind).toBe('home');
  });

  it('ignoring an alert marks it ignored and the mission goes on', () => {
    let w = forceEvent(until(started(), 300), 'dustDevil');
    const id = w.alerts.find((a) => a.id.startsWith('dust:forced:'))!.id;
    w = ignoreAlert(w, id);
    expect(w.alerts.find((a) => a.id === id)?.resolved).toBe('ignored');
    expect(proposal(w, id)).toBeNull();
    expect(adoptRoute(w, id, { path: PATH, stopIndices: [0, 10, 20], trip: TRIP })).toBe(w);
    w = tick(setSpeed(w, 100), 100);
    expect(w.run?.outcome?.kind).toBe('arrived');
  });
});

describe('look-ahead alerts in the world', () => {
  it('raises each look-ahead alert once', () => {
    // Oxygen falls fast enough to reach the 20% reserve on the way.
    let w = started(makeTrip(PATH, { 10: WORK_S }, 1.6));
    for (let i = 0; i < 100; i++) w = tick(w, 60);
    expect(w.alerts.filter((a) => a.id === 'o2:reserve')).toHaveLength(1);
    expect(new Set(w.alerts.map((a) => a.id)).size).toBe(w.alerts.length);
  });
});

describe('chat with the base', () => {
  it('answers 30 to 120 simulated seconds after a crew line, with a number from the crew state', () => {
    let w = until(started(), 400);
    const asked = w.utcMs;
    w = say(w, '  How is our oxygen?  ');
    expect(w.messages.at(-1)).toMatchObject({ from: 'crew', text: 'How is our oxygen?' });
    expect(w.pendingReplies).toHaveLength(1);
    w = tick(w, 29);
    expect(w.messages.some((m) => m.from === 'base')).toBe(false);
    w = tick(w, 92);
    const reply = w.messages.find((m) => m.from === 'base')!;
    expect(reply).toBeDefined();
    const delay = (reply.atUtcMs - asked) / 1000;
    expect(delay).toBeGreaterThanOrEqual(30);
    expect(delay).toBeLessThanOrEqual(120);
    const pct = Math.round(crewAt(w.run!, reply.atUtcMs).o2Frac! * 100);
    expect(reply.text).toContain(`${pct}%`);
    expect(w.pendingReplies).toHaveLength(0);
  });

  it('ignores an empty line and replies even with no mission', () => {
    const w = createWorld(DEPART);
    expect(say(w, '   ')).toBe(w);
    const x = tick(say(w, 'anyone there'), 121);
    expect(x.messages.find((m) => m.from === 'base')?.text).toMatch(/No mission is running/);
  });

  it('draws reply delays from the seed, so the same seed replays the same chat', () => {
    const a = tick(say(createWorld(DEPART, 42), 'status'), 200);
    const b = tick(say(createWorld(DEPART, 42), 'status'), 200);
    expect(a).toEqual(b);
  });
});
