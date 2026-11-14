import { describe, expect, it } from 'vitest';
import { destination } from '../lib/geo';
import { DEFAULT_SCENARIO } from './environment';
import { nextLtst, sunPosition } from './marsTime';
import { o2KgPerHour, walkingW } from './metabolic';
import { computeTrip, walkbackLimitHours } from './tripComputer';
import type { PathPoint, TripOptions, VehicleId } from './types';
import { toblerKmh, VEHICLES } from './vehicles';

const START: readonly [number, number] = [77.45, 18.44];
const BASE = Date.UTC(2021, 1, 20);
const MORNING = nextLtst(BASE, START[0], 8);
const RAD = Math.PI / 180;

/** A straight path heading east: lengthM long, a point every stepM, rising at gradeDeg. */
function line(lengthM: number, stepM: number, gradeDeg = 0, startElev = -2500): PathPoint[] {
  const pts: PathPoint[] = [];
  const n = Math.round(lengthM / stepM);
  for (let i = 0; i <= n; i++) {
    const d = i * stepM;
    const [lon, lat] = destination(START[0], START[1], 90, d);
    pts.push([lon, lat, startElev + d * Math.tan(gradeDeg * RAD)]);
  }
  return pts;
}

function opts(vehicle: VehicleId, extra: Partial<TripOptions> = {}): TripOptions {
  return { vehicle, departUtcMs: MORNING, scenario: DEFAULT_SCENARIO, style: 'safest', ...extra };
}

describe('computeTrip on awkward input', () => {
  it('returns a zero-length feasible result for an empty path', () => {
    const r = computeTrip([], opts('foot'));
    expect(r.samples).toEqual([]);
    expect(r.totals.distM).toBe(0);
    expect(r.totals.durationS).toBe(0);
    expect(r.totals.arriveUtcMs).toBe(MORNING);
    expect(r.feasible).toBe(true);
    expect(r.limitHit).toBeNull();
    expect(r.nightStops).toEqual([]);
  });

  it('returns a zero-length feasible result for a single point', () => {
    const r = computeTrip([[77.45, 18.44, -2500]], opts('pressRover'));
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0]?.distM).toBe(0);
    expect(r.samples[0]?.tS).toBe(0);
    expect(r.totals.distM).toBe(0);
    expect(r.feasible).toBe(true);
  });

  it('does not divide by zero on repeated points', () => {
    const p: PathPoint = [77.45, 18.44, -2500];
    const q: PathPoint = [77.46, 18.44, -2500];
    const r = computeTrip([p, p, p, q, q, q], opts('foot'));
    expect(r.samples).toHaveLength(6);
    for (const s of r.samples) {
      for (const v of [s.distM, s.tS, s.utcMs, s.gradeDeg, s.speedMs, s.doseMSv, s.tempC, s.tau, s.sunElevDeg]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(Number.isFinite(r.totals.durationS)).toBe(true);
    expect(Number.isFinite(r.totals.o2Kg)).toBe(true);
    expect(r.totals.distM).toBeGreaterThan(500);
  });

  it('clamps a stop index beyond the path to the last point', () => {
    const path = line(1000, 100);
    const r = computeTrip(path, opts('foot', { stops: [{ index: 999, workMin: 30 }, { index: -4, workMin: 10 }] }));
    expect(r.totals.workS).toBeCloseTo(40 * 60, 6);
    expect(r.samples.at(-1)?.state).toBe('work');
    expect(r.samples[0]?.state).toBe('work');
    expect(r.samples[0]?.tS).toBeCloseTo(600, 6);
  });

  it('copes with heights that are not numbers', () => {
    const path = line(1000, 100).map((p, i): PathPoint => (i === 4 ? [p[0], p[1], Number.NaN] : p));
    const r = computeTrip(path, opts('foot'));
    expect(Number.isFinite(r.totals.durationS)).toBe(true);
    expect(Number.isFinite(r.totals.climbM)).toBe(true);
  });
});

describe('computeTrip on foot', () => {
  it('walks 3.3 km of flat ground in an hour at about 250 W each', () => {
    const r = computeTrip(line(3300, 50), opts('foot'));
    expect(r.totals.distM).toBeCloseTo(3300, 0);
    expect(r.totals.durationS).toBeCloseTo(3600, -1);
    expect(r.totals.movingS).toBeCloseTo(r.totals.durationS, 6);
    const perPerson = o2KgPerHour(walkingW(3.3, 0));
    expect(r.totals.o2Kg).toBeCloseTo(2 * perPerson, 3);
    expect(r.feasible).toBe(true);
    expect(r.samples).toHaveLength(67);
    expect(r.samples.at(-1)?.o2Kg).toBeCloseTo(1.8 - r.totals.o2Kg, 6);
    expect(r.samples[0]?.batteryKWh).toBeNull();
    expect(r.totals.minBatteryFrac).toBeNull();
    expect(r.totals.waterL).toBeGreaterThan(0);
    expect(r.totals.doseMSv).toBeGreaterThan(0);
  });

  it('spends more oxygen going uphill: slower and harder', () => {
    const flat = computeTrip(line(2000, 50), opts('foot'));
    const up = computeTrip(line(2000, 50, 10), opts('foot'));
    expect(up.totals.durationS).toBeGreaterThan(flat.totals.durationS * 1.5);
    const hours = 2 / toblerKmh(10);
    expect(up.totals.o2Kg).toBeCloseTo(2 * hours * o2KgPerHour(walkingW(toblerKmh(10), 10)), 2);
    expect(up.totals.o2Kg).toBeGreaterThan(flat.totals.o2Kg * 2.5);
    expect(up.totals.climbM).toBeCloseTo(2000 * Math.tan(10 * RAD), 0);
    expect(up.totals.descentM).toBeCloseTo(0, 6);
    expect(up.totals.maxGradeDeg).toBeCloseTo(10, 1);
  });

  it('measures grade over at least 450 m, so a short bump does not stop a walker', () => {
    const path = line(2000, 10).map((p, i): PathPoint => (i === 100 ? [p[0], p[1], p[2] + 8] : p));
    const r = computeTrip(path, opts('foot'));
    expect(r.totals.maxGradeDeg).toBeLessThan(3);
    expect(r.limitHit).toBeNull();
  });

  it('works at stops at 300 W', () => {
    const path = line(1000, 100);
    const plain = computeTrip(path, opts('foot'));
    const withStop = computeTrip(path, opts('foot', { stops: [{ index: 5, workMin: 60, name: 'Outcrop' }] }));
    expect(withStop.totals.workS).toBeCloseTo(3600, 6);
    expect(withStop.totals.durationS - plain.totals.durationS).toBeCloseTo(3600, 3);
    expect(withStop.totals.o2Kg - plain.totals.o2Kg).toBeCloseTo(2 * o2KgPerHour(300), 4);
    expect(withStop.samples[5]?.state).toBe('work');
    expect(withStop.samples[4]?.state).toBe('move');
  });

  it('finds the point of no return by costing the walk back over the same ground with a 20% reserve', () => {
    const path = line(20_000, 100);
    const r = computeTrip(path, opts('foot'));
    const pnr = r.pointOfNoReturnIndex;
    expect(pnr).not.toBeNull();
    if (pnr === null) return;
    // On the flat the scrubbers bind: out and back within 80% of 8 h is 3.2 h each way, 10.56 km.
    expect(r.samples[pnr]?.distM).toBeGreaterThan(10_300);
    expect(r.samples[pnr]?.distM).toBeLessThanOrEqual(10_560 + 1);
    const w = r.warnings.find((x) => x.code === 'no-return');
    expect(w?.index).toBe(pnr);
    expect(w?.text).toMatch(/10\.[0-9] km/);
    expect(r.walkbackIndex).toBeNull();
  });

  it('costs the walk home the other way: a climb out leaves an easy way back, a descent out a hard one', () => {
    const climbOut = computeTrip(line(12_000, 100, 8), opts('foot'));
    const descendOut = computeTrip(line(12_000, 100, -8), opts('foot'));
    const a = climbOut.pointOfNoReturnIndex;
    const b = descendOut.pointOfNoReturnIndex;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) return;
    const backFromClimb = o2KgPerHour(walkingW(toblerKmh(-8), -8)) / toblerKmh(-8);
    const backFromDescent = o2KgPerHour(walkingW(toblerKmh(8), 8)) / toblerKmh(8);
    expect(backFromDescent).toBeGreaterThan(backFromClimb);
    // Out and back over the same ground costs the same either way round (one leg up, one down), so both
    // points of no return sit where an uphill leg plus a downhill leg fill 80% of the scrubbers. Costing the
    // way back as a repeat of the way out would put them 2.2 km nearer (climb) and 1.6 km farther (descent).
    const expectedM = 1000 * (6.4 / (1 / toblerKmh(8) + 1 / toblerKmh(-8)));
    for (const [r, i] of [[climbOut, a], [descendOut, b]] as const) {
      expect(r.samples[i]?.distM ?? 0).toBeLessThanOrEqual(expectedM + 1);
      expect(r.samples[i]?.distM ?? 0).toBeGreaterThan(expectedM - 101);
    }
  });

  it('has no point of no return on a short walk or on a loop that fits', () => {
    expect(computeTrip(line(3000, 100), opts('foot')).pointOfNoReturnIndex).toBeNull();
    const out = line(6000, 100);
    const loop = [...out, ...out.slice(0, -1).reverse()];
    const r = computeTrip(loop, opts('foot'));
    expect(r.pointOfNoReturnIndex).toBeNull();
    expect(r.feasible).toBe(true);
  });

  it('marks where the tanks hit zero and says how many km in', () => {
    // Four hours of work at the start leaves 0.54 kg each: about 7 h of walking, 23 km.
    const path = line(30_000, 100);
    const early = nextLtst(BASE, START[0], 6.6);
    const r = computeTrip(path, opts('foot', { departUtcMs: early, stops: [{ index: 0, workMin: 240 }] }));
    const out = r.o2OutIndex;
    expect(out).not.toBeNull();
    if (out === null) return;
    const perKm = (2 * o2KgPerHour(walkingW(3.3, 0))) / 3.3;
    const expectedKm = (1.8 - 2 * 4 * o2KgPerHour(300)) / perKm;
    expect(r.samples[out]?.distM ?? 0).toBeGreaterThanOrEqual(expectedKm * 1000 - 1);
    expect(r.samples[out]?.distM ?? 0).toBeLessThan(expectedKm * 1000 + 101);
    expect(r.samples[out]?.o2Kg).toBe(0);
    expect(r.samples[out - 1]?.o2Kg).toBeGreaterThan(0);
    const w = r.warnings.find((x) => x.code === 'o2-out');
    expect(w?.severity).toBe('warning');
    expect(w?.index).toBe(out);
    expect(w?.text).toBe(`Oxygen runs out ${expectedKm.toFixed(1)} km in.`);
    expect(r.feasible).toBe(false);
    expect(r.limitHit).toBe('o2');
    expect(r.totals.minO2Frac).toBe(0);
    expect(r.totals.o2Kg).toBeGreaterThan(1.8);
  });

  it('flags a walk longer than the scrubbers last', () => {
    const path = line(8000, 100);
    const r = computeTrip(path, opts('foot', { stops: [{ index: 40, workMin: 360 }] }));
    expect(r.totals.durationS).toBeGreaterThan(8 * 3600);
    expect(r.warnings.some((w) => w.code === 'scrubber-out')).toBe(true);
    expect(r.feasible).toBe(false);
  });

  it('sets limitHit to slope on a leg too steep to walk, and still samples the whole path', () => {
    const gentle = line(1000, 100);
    const last = gentle.at(-1);
    expect(last).toBeDefined();
    if (!last) return;
    const steep: PathPoint[] = [];
    for (let i = 1; i <= 6; i++) {
      const [lon, lat] = destination(last[0], last[1], 90, i * 100);
      steep.push([lon, lat, last[2] + i * 100 * Math.tan(32 * RAD)]);
    }
    const top = steep.at(-1);
    if (!top) return;
    const after: PathPoint[] = [];
    for (let i = 1; i <= 10; i++) {
      const [lon, lat] = destination(top[0], top[1], 90, i * 100);
      after.push([lon, lat, top[2]]);
    }
    const path = [...gentle, ...steep, ...after];
    const r = computeTrip(path, opts('foot'));
    expect(r.limitHit).toBe('slope');
    expect(r.feasible).toBe(false);
    expect(r.samples).toHaveLength(path.length);
    expect(r.samples.at(-1)?.distM).toBeCloseTo(2600, 0);
    for (let i = 1; i < r.samples.length; i++) {
      expect(r.samples[i]?.tS ?? 0).toBeGreaterThan(r.samples[i - 1]?.tS ?? 0);
      expect(r.samples[i]?.speedMs ?? 0).toBeGreaterThan(0);
    }
    const w = r.warnings.find((x) => x.code === 'slope-blocked');
    expect(w?.severity).toBe('warning');
    expect(w?.text).toMatch(/too steep/);
    expect(w?.text).toMatch(/25°/);
  });

  it('writes warnings in plain words with a stable code and no emoji', () => {
    const r = computeTrip(line(30_000, 100, 3), opts('foot', { stops: [{ index: 0, workMin: 200 }] }));
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const w of r.warnings) {
      expect(w.code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(w.text).toMatch(/^[A-Z].*\.$/);
      expect(w.text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(w.text).not.toMatch(/NaN|undefined|Infinity/);
      expect(['note', 'advisory', 'caution', 'warning']).toContain(w.severity);
    }
    expect(new Set(r.warnings.map((w) => w.code)).size).toBe(r.warnings.length);
  });
});

describe('computeTrip by rover', () => {
  it('drains the battery by rolling, climbing and hotel load, and recharges from the sun', () => {
    const flat = computeTrip(line(20_000, 200), opts('pressRover'));
    const up = computeTrip(line(20_000, 200, 5), opts('pressRover'));
    expect(flat.totals.energyKWh).toBeGreaterThan(10);
    expect(flat.totals.energyKWh).toBeLessThan(40);
    expect(up.totals.energyKWh).toBeGreaterThan(flat.totals.energyKWh * 1.3);
    expect(flat.totals.solarKWh).toBeGreaterThan(0);
    expect(flat.samples.at(-1)?.batteryKWh).toBeCloseTo(550 - flat.totals.energyKWh + flat.totals.solarKWh, 3);
    expect(flat.totals.minBatteryFrac).toBeGreaterThan(0.9);
    expect(flat.feasible).toBe(true);
  });

  it('rides seated at 150 W and gives the cabin crew a lower dose than walkers on the same ground', () => {
    const path = line(5000, 100);
    const rover = computeTrip(path, opts('pressRover'));
    const hours = rover.totals.durationS / 3600;
    expect(rover.totals.o2Kg).toBeCloseTo(2 * hours * o2KgPerHour(150), 4);
    const walkers = computeTrip(path, opts('foot'));
    const perHourRover = rover.totals.doseMSv / rover.totals.durationS;
    const perHourFoot = walkers.totals.doseMSv / walkers.totals.durationS;
    expect(perHourRover / perHourFoot).toBeCloseTo(VEHICLES.pressRover.doseFactor, 2);
  });

  it('slows only vehicles with a battery in eco style, and lowers their hotel load', () => {
    const path = line(10_000, 100);
    const footSafe = computeTrip(path, opts('foot'));
    const footEco = computeTrip(path, opts('foot', { style: 'eco' }));
    expect(footEco.totals.durationS).toBeCloseTo(footSafe.totals.durationS, 6);
    expect(footEco.totals.o2Kg).toBeCloseTo(footSafe.totals.o2Kg, 9);
    for (const id of ['openRover', 'pressRover'] as const) {
      const fast = computeTrip(path, opts(id, { style: 'fastest' }));
      const eco = computeTrip(path, opts(id, { style: 'eco' }));
      expect(eco.totals.durationS).toBeGreaterThan(fast.totals.durationS * 1.1);
      expect(eco.totals.energyKWh).toBeLessThan(fast.totals.energyKWh);
    }
  });

  it('marks the walk-home limit for crewed ground rovers only', () => {
    const path = line(60_000, 250);
    const open = computeTrip(path, opts('openRover'));
    const press = computeTrip(path, opts('pressRover'));
    expect(open.walkbackIndex).not.toBeNull();
    expect(press.walkbackIndex).not.toBeNull();
    expect(open.pointOfNoReturnIndex).toBeNull();
    expect(press.pointOfNoReturnIndex).toBeNull();
    const pressKm = (press.samples[press.walkbackIndex ?? 0]?.distM ?? 0) / 1000;
    const openKm = (open.samples[open.walkbackIndex ?? 0]?.distM ?? 0) / 1000;
    // Fresh suits from the cabin: 80% of 8 h of scrubbers at 3.3 km/h is 21.1 km.
    expect(pressKm).toBeGreaterThan(20.7);
    expect(pressKm).toBeLessThanOrEqual(21.13);
    // The open crew have already spent suit time on the ride out.
    expect(openKm).toBeLessThan(pressKm);
    expect(openKm).toBeGreaterThan(pressKm * 0.6);
    expect(openKm).toBeCloseTo(walkbackLimitHours(VEHICLES.openRover) * 3.3, 0);
    expect(open.warnings.find((w) => w.code === 'walkback')?.severity).toBe('warning');
    expect(press.warnings.find((w) => w.code === 'walkback')?.severity).toBe('advisory');
    expect(computeTrip(path, opts('robotRover')).walkbackIndex).toBeNull();
    expect(computeTrip(line(5000, 100), opts('openRover')).walkbackIndex).toBeNull();
  });

  it('waits for sunrise where the vehicle needs daylight, and lists the night stop', () => {
    // 1.5 km at 152 m/h is about 10 h, inside one day's light (2 km would take 13 h and a second night).
    const path = line(1500, 100);
    const night = nextLtst(BASE, START[0], 22);
    const r = computeTrip(path, opts('robotRover', { departUtcMs: night }));
    expect(r.nightStops).toHaveLength(1);
    const stop = r.nightStops[0];
    expect(stop?.index).toBe(0);
    expect(stop?.fromUtcMs).toBe(night);
    expect(Math.abs(sunPosition(stop?.toUtcMs ?? 0, START[1], START[0]).elevDeg)).toBeLessThan(0.5);
    expect(r.samples[0]?.state).toBe('wait');
    expect(r.totals.waitS).toBeGreaterThan(6 * 3600);
    expect(r.totals.waitS).toBeLessThan(9 * 3600);
    expect(r.warnings.some((w) => w.code === 'night-wait')).toBe(true);
    expect(r.feasible).toBe(true);
  });

  it('stops a robot at sunset part way along and goes on after sunrise', () => {
    // 152 m/h: 4 km takes more than two days of daylight.
    const path = line(4000, 100);
    const r = computeTrip(path, opts('robotRover'));
    expect(r.nightStops.length).toBeGreaterThanOrEqual(2);
    for (const s of r.nightStops) {
      expect(s.toUtcMs).toBeGreaterThan(s.fromUtcMs);
      expect(sunPosition(s.fromUtcMs + 3_600_000, START[1], START[0]).elevDeg).toBeLessThan(0);
    }
    for (let i = 1; i < r.samples.length; i++) {
      const a = r.samples[i - 1];
      const b = r.samples[i];
      if (!a || !b) continue;
      if (b.state === 'move') expect(b.sunElevDeg).toBeGreaterThan(-0.5);
      expect(b.utcMs).toBeGreaterThan(a.utcMs);
    }
    expect(r.totals.durationS).toBeCloseTo(r.totals.movingS + r.totals.workS + r.totals.waitS, 3);
  });

  it('says a suited crew cannot spend the night outside', () => {
    const path = line(40_000, 250);
    const late = nextLtst(BASE, START[0], 15.5);
    const r = computeTrip(path, opts('openRover', { departUtcMs: late }));
    expect(r.nightStops.length).toBeGreaterThanOrEqual(1);
    expect(r.feasible).toBe(false);
    expect(r.warnings.some((w) => w.code === 'night-in-suits')).toBe(true);
  });

  it('camps the pressurised rover at sunset when asked, and drives through the night when not', () => {
    const path = line(120_000, 500);
    const afternoon = nextLtst(BASE, START[0], 13);
    const camp = computeTrip(path, opts('pressRover', { departUtcMs: afternoon, campAtNight: true }));
    const through = computeTrip(path, opts('pressRover', { departUtcMs: afternoon, campAtNight: false }));
    expect(through.nightStops).toEqual([]);
    expect(through.totals.waitS).toBe(0);
    expect(through.warnings.some((w) => w.code === 'ends-after-dark' || w.code === 'night-drive')).toBe(true);
    expect(camp.nightStops).toHaveLength(1);
    const stop = camp.nightStops[0];
    expect(stop).toBeDefined();
    if (!stop) return;
    expect(camp.samples[stop.index]?.state).toBe('camp');
    expect((stop.toUtcMs - stop.fromUtcMs) / 3_600_000).toBeGreaterThan(11);
    expect((stop.toUtcMs - stop.fromUtcMs) / 3_600_000).toBeLessThan(13.5);
    expect(camp.totals.durationS).toBeGreaterThan(through.totals.durationS + 11 * 3600);
    expect(camp.totals.movingS).toBeCloseTo(through.totals.movingS, -1);
    expect(camp.feasible).toBe(true);
    expect(camp.warnings.some((w) => w.code === 'camp')).toBe(true);
    // Walkers cannot camp, whatever the flag says.
    const foot = computeTrip(line(2000, 100), opts('foot', { campAtNight: true }));
    expect(foot.nightStops).toEqual([]);
  });

  it('runs a small helicopter out of charge after about a kilometre and a half', () => {
    const r = computeTrip(line(4000, 100), opts('heli'));
    expect(r.limitHit).toBe('battery');
    const w = r.warnings.find((x) => x.code === 'battery-out');
    expect(w?.text).toMatch(/^Battery runs out [12]\.[0-9] km in\.$/);
    expect(computeTrip(line(800, 50), opts('heli')).limitHit).toBeNull();
  });
});

describe('walkbackLimitHours', () => {
  it('is 80% of the scrubber life for a fresh suit: 6.4 h', () => {
    expect(walkbackLimitHours()).toBeCloseTo(6.4, 6);
    expect(walkbackLimitHours(VEHICLES.foot)).toBeCloseTo(6.4, 6);
    expect(walkbackLimitHours(VEHICLES.pressRover)).toBeCloseTo(6.4, 6);
  });

  it('is shorter for the open rover, whose crew use suit time on the ride out', () => {
    const h = walkbackLimitHours(VEHICLES.openRover);
    expect(h).toBeLessThan(6.4);
    expect(h).toBeGreaterThan(4);
  });

  it('is zero where there is no crew', () => {
    expect(walkbackLimitHours(VEHICLES.robotRover)).toBe(0);
    expect(walkbackLimitHours(VEHICLES.heli)).toBe(0);
  });
});
