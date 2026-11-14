import { describe, expect, it } from 'vitest';
import {
  conditionsAt,
  DEFAULT_SCENARIO,
  doseMSvPerSol,
  meteorShowers,
  pressurePa,
  tauAt,
  temperatureC,
  visibilityKm,
} from './environment';
import { dateForLs, marsTime, nextLtst, sunPosition } from './marsTime';
import type { Scenario } from './types';

const START = Date.UTC(2021, 1, 18, 20, 55);
const JEZERO = { lat: 18.44, lon: 77.45, elev: -2500 };
const GALE_ELEV = -4500;
const DAY = 86_400_000;

const at = (ls: number) => dateForLs(ls, START);
const hourAt = (utc: number, lon: number, h: number) => nextLtst(utc, lon, h);

describe('DEFAULT_SCENARIO', () => {
  it('is a clear sky, no particle event, mid solar cycle', () => {
    expect(DEFAULT_SCENARIO).toEqual({ dust: 'clear', solarEvent: false, solarCycle: 0.5 });
  });
});

describe('pressurePa', () => {
  it('is 560 Pa at the datum and falls by 1/e every 11.1 km', () => {
    expect(pressurePa(0)).toBeCloseTo(560, 6);
    expect(pressurePa(11_100)).toBeCloseTo(560 / Math.E, 6);
    expect(pressurePa(-11_100)).toBeCloseTo(560 * Math.E, 6);
    expect(pressurePa(JEZERO.elev)).toBeGreaterThan(680);
    expect(pressurePa(JEZERO.elev)).toBeLessThan(720);
  });

  it('follows the seasonal CO2 cycle when given a date: lowest near Ls 150, highest near Ls 255', () => {
    const mean = pressurePa(0);
    let sum = 0;
    let n = 0;
    let lo = { ls: 0, p: Infinity };
    let hi = { ls: 0, p: -Infinity };
    for (let ls = 0; ls < 360; ls += 5) {
      const p = pressurePa(0, at(ls));
      sum += p;
      n += 1;
      if (p < lo.p) lo = { ls, p };
      if (p > hi.p) hi = { ls, p };
    }
    expect(Math.abs(lo.ls - 150)).toBeLessThanOrEqual(15);
    expect(Math.abs(hi.ls - 255)).toBeLessThanOrEqual(15);
    expect(lo.p / mean).toBeGreaterThan(0.85);
    expect(hi.p / mean).toBeLessThan(1.15);
    expect(hi.p / lo.p).toBeGreaterThan(1.15);
    expect(sum / n / mean).toBeCloseTo(1, 2);
  });
});

describe('tauAt', () => {
  it('is low in the clear season and higher in the dusty season', () => {
    const clearSeason = tauAt(JEZERO.lat, JEZERO.lon, at(100), DEFAULT_SCENARIO);
    const dustySeason = tauAt(JEZERO.lat, JEZERO.lon, at(235), DEFAULT_SCENARIO);
    expect(clearSeason).toBeGreaterThan(0.25);
    expect(clearSeason).toBeLessThan(0.5);
    expect(dustySeason).toBeGreaterThan(0.75);
    expect(dustySeason).toBeLessThan(1.2);
  });

  it('raises dust inside a regional storm and leaves the sky outside it alone', () => {
    const storm: Scenario = { ...DEFAULT_SCENARIO, dust: 'regionalStorm', storm: { lon: 77.45, lat: 18.44, radiusKm: 100 } };
    const base = tauAt(18.44, 77.45, START, DEFAULT_SCENARIO);
    const centre = tauAt(18.44, 77.45, START, storm);
    const halfway = tauAt(18.44 + 0.84, 77.45, START, storm); // about 50 km north
    const outside = tauAt(18.44 + 2.5, 77.45, START, storm); // about 148 km north
    expect(centre).toBeGreaterThan(base + 1.5);
    expect(halfway).toBeGreaterThan(base);
    expect(halfway).toBeLessThan(centre);
    expect(outside).toBeCloseTo(base, 9);
  });

  it('puts a regional storm with no centre given over the middle of the region', () => {
    const storm: Scenario = { ...DEFAULT_SCENARIO, dust: 'regionalStorm' };
    expect(tauAt(18.45, 77.45, START, storm)).toBeGreaterThan(tauAt(18.45, 77.45, START, DEFAULT_SCENARIO) + 1.5);
  });

  it('is high everywhere in a global storm', () => {
    const global: Scenario = { ...DEFAULT_SCENARIO, dust: 'globalStorm' };
    for (const [lat, lon] of [
      [18.44, 77.45],
      [-60, 200],
      [80, -30],
    ] as const) {
      expect(tauAt(lat, lon, at(100), global)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('temperatureC', () => {
  const noonish = hourAt(START, JEZERO.lon, 14);
  const dawn = hourAt(START, JEZERO.lon, 5.5);

  it('swings at Jezero from about -25 C in the afternoon to about -80 C before dawn, as MEDA measured', () => {
    const warm = temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, noonish, DEFAULT_SCENARIO);
    const cold = temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, dawn, DEFAULT_SCENARIO);
    expect(warm).toBeGreaterThan(-35);
    expect(warm).toBeLessThan(-10);
    expect(cold).toBeGreaterThan(-95);
    expect(cold).toBeLessThan(-70);
  });

  it('is warmest in the early afternoon and coldest around dawn', () => {
    const samples: { h: number; t: number }[] = [];
    for (let h = 0; h < 24; h += 0.5) {
      samples.push({ h, t: temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, hourAt(START, JEZERO.lon, h), DEFAULT_SCENARIO) });
    }
    const warmest = samples.reduce((a, b) => (b.t > a.t ? b : a));
    const coldest = samples.reduce((a, b) => (b.t < a.t ? b : a));
    expect(warmest.h).toBeGreaterThanOrEqual(12.5);
    expect(warmest.h).toBeLessThanOrEqual(15);
    expect(coldest.h).toBeGreaterThanOrEqual(4);
    expect(coldest.h).toBeLessThanOrEqual(6.5);
  });

  it('changes smoothly through the day, with no jump at midnight', () => {
    let prev = temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, noonish, DEFAULT_SCENARIO);
    for (let i = 1; i <= 300; i++) {
      const t = temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, noonish + i * 300_000, DEFAULT_SCENARIO);
      expect(Math.abs(t - prev)).toBeLessThan(2.5);
      prev = t;
    }
  });

  it('is colder higher up', () => {
    const low = temperatureC(JEZERO.lat, JEZERO.lon, -2500, noonish, DEFAULT_SCENARIO);
    const high = temperatureC(JEZERO.lat, JEZERO.lon, 1500, noonish, DEFAULT_SCENARIO);
    expect(high).toBeLessThan(low);
    expect(low - high).toBeLessThan(20);
  });

  it('is colder in the dark of polar winter, but never below the CO2 frost point', () => {
    const winter = at(270);
    const pole = temperatureC(85, 0, -4000, winter, DEFAULT_SCENARIO);
    expect(pole).toBeLessThan(-110);
    expect(pole).toBeGreaterThanOrEqual(-125.5);
  });

  it('follows the season at mid latitudes', () => {
    const summer = temperatureC(50, 0, 0, hourAt(at(90), 0, 14), DEFAULT_SCENARIO);
    const winter = temperatureC(50, 0, 0, hourAt(at(270), 0, 14), DEFAULT_SCENARIO);
    expect(summer).toBeGreaterThan(winter + 15);
  });

  it('has a smaller day-night swing under a global dust storm', () => {
    const global: Scenario = { ...DEFAULT_SCENARIO, dust: 'globalStorm' };
    const swing = (s: Scenario) =>
      temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, noonish, s) - temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, dawn, s);
    expect(swing(global)).toBeLessThan(swing(DEFAULT_SCENARIO) * 0.7);
    expect(swing(global)).toBeGreaterThan(5);
  });
});

describe('doseMSvPerSol', () => {
  it('is the Curiosity RAD value, 0.64 mSv per sol, at Gale mid solar cycle', () => {
    let sum = 0;
    let n = 0;
    for (let ls = 0; ls < 360; ls += 10) {
      const d = doseMSvPerSol(GALE_ELEV, at(ls), DEFAULT_SCENARIO);
      expect(Math.abs(d - 0.64) / 0.64).toBeLessThan(0.08);
      sum += d;
      n += 1;
    }
    expect(sum / n).toBeCloseTo(0.64, 2);
  });

  it('rises with elevation, as there is less air overhead, but stays the same order', () => {
    const gale = doseMSvPerSol(GALE_ELEV, START, DEFAULT_SCENARIO);
    const jezero = doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO);
    const summit = doseMSvPerSol(21_000, START, DEFAULT_SCENARIO);
    expect(jezero).toBeGreaterThan(gale);
    expect(summit).toBeGreaterThan(jezero);
    expect(summit).toBeLessThan(gale * 2);
  });

  it('scales with shielding', () => {
    const open = doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO);
    expect(doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO, 0.5)).toBeCloseTo(open / 2, 9);
    expect(doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO, 1)).toBeCloseTo(open, 9);
  });

  it('is higher at solar minimum than at solar maximum', () => {
    const min = doseMSvPerSol(GALE_ELEV, START, { ...DEFAULT_SCENARIO, solarCycle: 0 });
    const mid = doseMSvPerSol(GALE_ELEV, START, { ...DEFAULT_SCENARIO, solarCycle: 0.5 });
    const max = doseMSvPerSol(GALE_ELEV, START, { ...DEFAULT_SCENARIO, solarCycle: 1 });
    expect(min).toBeGreaterThan(mid * 1.2);
    expect(max).toBeLessThan(mid * 0.85);
    expect(max).toBeGreaterThan(0);
    // Out-of-range input is clamped rather than extrapolated.
    expect(doseMSvPerSol(GALE_ELEV, START, { ...DEFAULT_SCENARIO, solarCycle: 7 })).toBeCloseTo(max, 9);
    expect(doseMSvPerSol(GALE_ELEV, START, { ...DEFAULT_SCENARIO, solarCycle: -3 })).toBeCloseTo(min, 9);
  });

  it('at least doubles during a solar particle event', () => {
    const quiet = doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO);
    const event = doseMSvPerSol(JEZERO.elev, START, { ...DEFAULT_SCENARIO, solarEvent: true });
    expect(event).toBeGreaterThan(quiet * 2);
    expect(event).toBeLessThan(quiet * 20);
  });
});

describe('visibilityKm', () => {
  it('shrinks as dust thickens', () => {
    expect(visibilityKm(0.5)).toBeGreaterThan(60);
    expect(visibilityKm(0.5)).toBeLessThan(120);
    expect(visibilityKm(5)).toBeLessThan(15);
    expect(visibilityKm(5)).toBeGreaterThan(2);
    expect(visibilityKm(1)).toBeLessThan(visibilityKm(0.5));
  });

  it('stays finite and positive for a dust-free or nonsense input', () => {
    for (const tau of [0, -1, Number.NaN]) {
      const v = visibilityKm(tau);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('conditionsAt', () => {
  it('bundles the single models for one place and moment', () => {
    const c = conditionsAt(JEZERO.lat, JEZERO.lon, JEZERO.elev, START, DEFAULT_SCENARIO);
    const sun = sunPosition(START, JEZERO.lat, JEZERO.lon);
    expect(c.tempC).toBeCloseTo(temperatureC(JEZERO.lat, JEZERO.lon, JEZERO.elev, START, DEFAULT_SCENARIO), 9);
    expect(c.pressurePa).toBeCloseTo(pressurePa(JEZERO.elev, START), 9);
    expect(c.tau).toBeCloseTo(tauAt(JEZERO.lat, JEZERO.lon, START, DEFAULT_SCENARIO), 9);
    expect(c.doseMSvPerSol).toBeCloseTo(doseMSvPerSol(JEZERO.elev, START, DEFAULT_SCENARIO), 9);
    expect(c.visibilityKm).toBeCloseTo(visibilityKm(c.tau), 9);
    expect(c.sunElevDeg).toBeCloseTo(sun.elevDeg, 9);
    expect(c.sunAzDeg).toBeCloseTo(sun.azDeg, 9);
    expect(c.ltstH).toBeCloseTo(marsTime(START, JEZERO.lon).ltstH, 9);
  });
});

describe('meteorShowers', () => {
  it('lists showers with a parent body, a solar longitude and a note', () => {
    const list = meteorShowers(START);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(new Set(list.map((s) => s.name)).size).toBe(list.length);
    for (const s of list) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.parent.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
      expect(s.lsDeg).toBeGreaterThanOrEqual(0);
      expect(s.lsDeg).toBeLessThan(360);
      expect(typeof s.active).toBe('boolean');
    }
  });

  it('marks a yearly shower active near its solar longitude and quiet half a year away', () => {
    const yearly = meteorShowers(START).find((s) => !/2014/.test(s.note));
    expect(yearly).toBeDefined();
    if (!yearly) return;
    const peak = at(yearly.lsDeg);
    expect(meteorShowers(peak).find((s) => s.name === yearly.name)?.active).toBe(true);
    const farSide = dateForLs(yearly.lsDeg + 180, START);
    expect(meteorShowers(farSide).find((s) => s.name === yearly.name)?.active).toBe(false);
  });

  it('marks the 2014 Siding Spring encounter active only on the day it happened', () => {
    const encounter = Date.UTC(2014, 9, 19, 18, 27);
    const name = meteorShowers(encounter).find((s) => /Siding Spring/.test(s.parent))?.name;
    expect(name).toBeDefined();
    expect(meteorShowers(encounter).find((s) => s.name === name)?.active).toBe(true);
    expect(meteorShowers(encounter + 687 * DAY).find((s) => s.name === name)?.active).toBe(false);
    expect(meteorShowers(encounter + 30 * DAY).find((s) => s.name === name)?.active).toBe(false);
  });
});
