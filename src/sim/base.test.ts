import { describe, expect, it } from 'vitest';
import { nextLtst } from '@/engines/marsTime';
import type { MissionPlan, PathPoint, Scenario, TripResult, TripSample, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { pathStats, shapeOnlyTrip } from '@/planner/geometry';
import { baseReply } from './base';
import type { MissionRun } from './types';
import { createWorld, crewAt, startMission } from './world';

const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const LON = 77.4;
const north = (m: number): PathPoint => [LON, 18.4 + m / M_PER_DEG, -2500];
const PATH: PathPoint[] = Array.from({ length: 21 }, (_, i) => north(i * 100));
const DEPART = nextLtst(Date.UTC(2026, 10, 14), LON, 10);

/** Straight 2 km, samples every 100 m, 30 minutes of work at 1 km. */
function trip(vehicle: VehicleId): TripResult {
  const v = VEHICLES[vehicle];
  const along = pathStats(PATH).along;
  const bat = v.batteryKWh + v.extenderKWh;
  let t = 0;
  const samples: TripSample[] = PATH.map((p, i) => {
    if (i > 0) t += ((along[i] ?? 0) - (along[i - 1] ?? 0)) / v.flatSpeedMs;
    if (i === 10) t += 1800;
    return {
      distM: along[i] ?? 0, tS: t, utcMs: 0, elev: p[2], gradeDeg: 0, speedMs: v.flatSpeedMs,
      state: i === 10 ? 'work' : 'move', o2Kg: 1.8 - (0.1 * t) / 3600,
      batteryKWh: bat > 0 && v.kind !== 'walk' ? bat - (bat * 0.9 * t) / 4000 : null,
      waterL: 0, doseMSv: (0.01 * t) / 3600, tempC: -43, tau: 0.6, sunElevDeg: 30,
    };
  });
  const base = shapeOnlyTrip(PATH);
  return { ...base, samples, totals: { ...base.totals, durationS: t } };
}

function run(vehicle: VehicleId = 'foot', scenario?: Scenario): MissionRun {
  const s = north(1000);
  const plan: MissionPlan = {
    start: { lon: LON, lat: 18.4, name: 'Base camp' },
    stops: [{ id: 's1', lon: s[0], lat: s[1], name: 'Delta front', tasks: [{ id: 't1', kind: 'sample', minutes: 30 }] }],
    roundTrip: false,
    vehicle,
    style: 'safest',
    campAtNight: false,
  };
  const w = startMission(
    createWorld(DEPART),
    { name: 'Test', plan, path: PATH, stopIndices: [0, 10, 20], trip: trip(vehicle), ...(scenario ? { scenario } : {}) },
    DEPART,
  );
  return w.run!;
}

function ask(text: string, r: MissionRun, atS: number): string {
  const t = DEPART + atS * 1000;
  return baseReply(text, crewAt(r, t), r, t);
}

/** Plain words: no emoji, no exclamation marks. */
function plain(s: string): void {
  expect(s).not.toMatch(/!/);
  expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(s.length).toBeLessThan(300);
}

describe('baseReply', () => {
  const r = run();

  it('answers about oxygen with the percentage and kilograms from the snapshot', () => {
    const c = crewAt(r, DEPART + 600_000);
    const s = ask('How is our air?', r, 600);
    expect(s).toContain(`${Math.round(c.o2Frac! * 100)}%`);
    expect(s).toContain(`${c.o2Kg!.toFixed(2)} kg`);
    plain(s);
  });

  it('answers about power from the battery, and says when there is none', () => {
    const rover = run('pressRover');
    const c = crewAt(rover, DEPART + 600_000);
    const s = ask('battery check', rover, 600);
    expect(s).toContain(`${c.batteryKWh!.toFixed(1)} kWh`);
    plain(s);
    expect(ask('how much power do we have', r, 600)).toMatch(/no battery on foot/);
  });

  it('answers about time with the local solar time and time out', () => {
    const s = ask('what time is it', r, 3600);
    expect(s).toMatch(/It is \d\d:\d\d local solar time on sol \d+\./);
    expect(s).toMatch(/out 1\sh\./);
    plain(s);
  });

  it('answers about sunset with a clock time and a duration', () => {
    const s = ask('When is sunset?', r, 600);
    expect(s).toMatch(/^Sunset at \d\d:\d\d local solar time, in \d/);
    expect(s).toMatch(/needs daylight/);
    plain(s);
  });

  it('answers about the next stop with its name and distance', () => {
    const s = ask("what's next", r, 300);
    expect(s).toMatch(/^Next is Delta front, \d+\sm ahead, about \d+\smin away\.$/);
    expect(ask('next stop', r, 1500)).toMatch(/^You are at Delta front\./);
  });

  it('answers about radiation with the dose and the scenario', () => {
    expect(ask('radiation dose?', r, 3600)).toMatch(/^The dose so far is 0\.01 mSv\. No solar particle event/);
    const solar = run('foot', { dust: 'clear', solarEvent: true, solarCycle: 0.5 });
    expect(ask('radiation', solar, 3600)).toMatch(/particle event is under way/);
  });

  it('answers about dust and weather from the trip samples and the scenario', () => {
    const s = ask('any dust storms coming?', r, 600);
    expect(s).toMatch(/−43\s°C/);
    expect(s).toMatch(/optical depth is 0\.6/);
    expect(s).toMatch(/No dust storm/);
    plain(s);
  });

  it('gives a status line with numbers for status and for anything else', () => {
    const s = ask('status report', r, 300);
    expect(s).toMatch(/^Moving at 3\.3 km\/h, \d+\sm covered, oxygen \d+%\. 0 of 1 tasks done\.$/);
    const other = ask('tell me a joke', r, 300);
    expect(other).toMatch(/^Copy\. Moving at/);
    plain(other);
  });

  it('says so when no mission is running', () => {
    expect(baseReply('oxygen?', null, null, DEPART)).toMatch(/No mission is running/);
  });
});
