import { describe, expect, it } from 'vitest';
import { lookAhead, SEVERITY_RANK, sortAlerts } from './alerts';
import type { LookAheadRun } from './alerts';
import { nextLtst, sunriseSunset } from './marsTime';
import type { Alert, CrewSnapshot, PathPoint, TripResult, TripSample, VehicleId } from './types';
import { shapeOnlyTrip } from '@/planner/geometry';

const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const LON = 77.4;
const LAT0 = 18.4;
// 09:00 local solar time, so sunset is hours away unless a test moves the clock.
const T0 = nextLtst(Date.UTC(2026, 10, 14), LON, 9);
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** Points every 100 m north: flat to 1 km, 20 degrees to 1.5 km, one 30 degree step to 1.6 km, flat after. */
function steepPath(): PathPoint[] {
  const out: PathPoint[] = [];
  let z = -2500;
  for (let i = 0; i <= 20; i++) {
    const m = i * 100;
    if (m > 1000 && m <= 1500) z += 100 * tan(20);
    else if (m > 1500 && m <= 1600) z += 100 * tan(30);
    out.push([LON, LAT0 + m / M_PER_DEG, z]);
  }
  return out;
}

const FLAT: PathPoint[] = Array.from({ length: 21 }, (_, i) => [LON, LAT0 + (i * 100) / M_PER_DEG, -2500] as const);

/** At 1 m/s, so a sample's time in seconds is its distance in metres. */
function trip(path: PathPoint[], extra: Partial<TripResult> = {}): TripResult {
  const samples: TripSample[] = path.map((p, i) => ({
    distM: i * 100, tS: i * 100, utcMs: 0, elev: p[2], gradeDeg: 0, speedMs: 1, state: 'move',
    o2Kg: 1.8, batteryKWh: null, waterL: 0, doseMSv: 0, tempC: -40, tau: 0.5, sunElevDeg: 30,
  }));
  const base = shapeOnlyTrip(path);
  return { ...base, samples, totals: { ...base.totals, durationS: 2000 }, ...extra };
}

function run(path: PathPoint[], vehicle: VehicleId = 'foot', extra: Partial<TripResult> = {}): LookAheadRun {
  return { vehicle, path, trip: trip(path, extra), legStartUtcMs: T0 };
}

function crew(distM: number, over: Partial<CrewSnapshot> = {}): CrewSnapshot {
  return {
    utcMs: T0 + distM * 1000, distM, lon: LON, lat: LAT0 + distM / M_PER_DEG, elev: -2500, headingDeg: 0, speedMs: 1,
    state: 'move', o2Kg: 1.5, o2Frac: 0.83, batteryKWh: null, batteryFrac: null, doseMSv: 0, ...over,
  };
}

const MORNING = T0;

const ids = (as: Alert[]) => as.map((a) => a.id);

describe('severity order', () => {
  it('ranks warning over caution over advisory over note', () => {
    expect(SEVERITY_RANK.warning).toBeGreaterThan(SEVERITY_RANK.caution);
    expect(SEVERITY_RANK.caution).toBeGreaterThan(SEVERITY_RANK.advisory);
    expect(SEVERITY_RANK.advisory).toBeGreaterThan(SEVERITY_RANK.note);
  });

  it('sorts most severe first and newest first within a severity, without changing the input', () => {
    const mk = (id: string, severity: Alert['severity'], atUtcMs: number): Alert => ({ id, severity, title: id, body: id, source: 'event', atUtcMs });
    const input = [mk('a', 'note', 5), mk('b', 'warning', 1), mk('c', 'caution', 2), mk('d', 'caution', 9), mk('e', 'advisory', 3)];
    expect(ids(sortAlerts(input))).toEqual(['b', 'd', 'c', 'e', 'a']);
    expect(ids(input)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('steep ground', () => {
  const r = run(steepPath());
  const at = (d: number) => lookAhead({ run: r, crew: crew(d, { utcMs: MORNING }) });

  it('stays quiet when the steep ground is more than 300 m ahead', () => {
    expect(at(600)).toEqual([]);
    expect(at(750)).toEqual([]);
  });

  it('gives a caution within 300 m for ground above the comfortable slope', () => {
    const [a] = at(820);
    expect(a?.severity).toBe('caution');
    expect(a?.title).toBe('Steep ground ahead');
    expect(a?.body).toMatch(/280\sm ahead the ground reaches 20°/);
    expect(a?.action).toBeUndefined();
    expect(a?.speak).toBeTruthy();
  });

  it('keeps the same id while the crew drives through the same stretch', () => {
    const first = at(820)[0]?.id;
    expect(at(1200)[0]?.id).toBe(first);
    expect(at(1250)[0]?.id).toBe(first);
  });

  it('warns, with a reroute, for ground past the blocking slope', () => {
    const [a] = at(1300);
    expect(a?.severity).toBe('warning');
    expect(a?.body).toMatch(/30°, past the 25°/);
    expect(a?.action?.kind).toBe('reroute');
    expect(a?.id).not.toBe(at(820)[0]?.id);
  });

  it('ignores slope for a helicopter', () => {
    expect(lookAhead({ run: run(steepPath(), 'heli'), crew: crew(1300, { utcMs: MORNING, o2Kg: null, o2Frac: null }) })).toEqual([]);
  });
});

describe('point of no return', () => {
  const r = run(FLAT, 'foot', { pointOfNoReturnIndex: 15 });

  it('gives a caution with a turn back in the last 10 minutes before it', () => {
    const [a] = lookAhead({ run: r, crew: crew(1000) });
    expect(a?.id.startsWith('pnr:')).toBe(true);
    expect(a?.severity).toBe('caution');
    expect(a?.action?.kind).toBe('turnBack');
    expect(a?.body).toMatch(/In about 8\smin, 500\sm ahead/);
  });

  it('stays quiet further out and once it is passed', () => {
    expect(ids(lookAhead({ run: r, crew: crew(800) }))).toEqual([]);
    expect(ids(lookAhead({ run: r, crew: crew(1600) }))).toEqual([]);
  });
});

describe('sunset', () => {
  const { setUtcMs } = sunriseSunset(T0, LAT0, LON);
  const r = run(FLAT);
  const near = (minutes: number, vehicle: VehicleId = 'foot', endUtcMs = Infinity) =>
    lookAhead({ run: { ...r, vehicle }, crew: crew(500, { utcMs: setUtcMs - minutes * 60_000 }), endUtcMs });

  it('gives an advisory within 40 minutes and a caution within 15 for a vehicle that needs daylight', () => {
    expect(near(50)).toEqual([]);
    const [a] = near(30);
    expect(a?.severity).toBe('advisory');
    expect(a?.body).toMatch(/sets in 30\smin/);
    const [b] = near(10);
    expect(b?.severity).toBe('caution');
    expect(b?.id).not.toBe(a?.id);
  });

  it('stays quiet for a pressurised rover, and for a crew done before dark', () => {
    expect(near(10, 'pressRover')).toEqual([]);
    expect(near(10, 'foot', setUtcMs - 60_000)).toEqual([]);
  });
});

describe('consumables', () => {
  const r = run(FLAT);

  it('warns at the oxygen reserve, with a turn back', () => {
    const [a] = lookAhead({ run: r, crew: crew(500, { utcMs: MORNING, o2Kg: 0.32, o2Frac: 0.18 }) });
    expect(a).toMatchObject({ id: 'o2:reserve', severity: 'warning', action: { kind: 'turnBack' } });
    expect(a?.body).toMatch(/18% \(0\.32 kg\)/);
    expect(lookAhead({ run: r, crew: crew(500, { utcMs: MORNING, o2Frac: 0.25 }) })).toEqual([]);
  });

  it('gives a caution under 15% battery', () => {
    const rr = run(FLAT, 'openRover');
    const [a] = lookAhead({ run: rr, crew: crew(500, { utcMs: MORNING, batteryKWh: 1.6, batteryFrac: 0.1 }) });
    expect(a).toMatchObject({ id: 'battery:low', severity: 'caution' });
    expect(lookAhead({ run: rr, crew: crew(500, { utcMs: MORNING, batteryKWh: 4, batteryFrac: 0.25 }) })).toEqual([]);
  });

  it('lists several at once, most severe first, and nothing once the crew is done', () => {
    const c = crew(500, { utcMs: MORNING, o2Kg: 0.32, o2Frac: 0.18, batteryKWh: 1.6, batteryFrac: 0.1 });
    expect(ids(lookAhead({ run: run(FLAT, 'openRover'), crew: c }))).toEqual(['o2:reserve', 'battery:low']);
    expect(lookAhead({ run: r, crew: { ...c, state: 'done' } })).toEqual([]);
  });
});
