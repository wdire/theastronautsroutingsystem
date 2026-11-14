import { describe, expect, it } from 'vitest';
import { SOL_S } from '../lib/constants';
import { dateForLs, lightTimeS, marsTime, nextLtst, nextSunrise, sunPosition, sunriseSunset } from './marsTime';

const SOL_MS = SOL_S * 1000;
const PERSEVERANCE_LANDING = Date.UTC(2021, 1, 18, 20, 55);
const CURIOSITY_LANDING = Date.UTC(2012, 7, 6, 5, 17);
const JEZERO = { lat: 18.44, lon: 77.45 };
const GALE = { lat: -4.59, lon: 137.44 };

/** Smallest distance between two clock readings, hours. */
function clockDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

describe('marsTime', () => {
  it('reproduces the worked example published with the Mars24 algorithm (2000-01-06 00:00 UTC)', () => {
    const t = marsTime(Date.UTC(2000, 0, 6), 0);
    expect(t.msd).toBeCloseTo(44795.9998, 3);
    expect(t.lsDeg).toBeCloseTo(277.1876, 2);
    // Coordinated Mars Time 23:59:39 and true solar time 23:38:54 at the prime meridian.
    expect(t.lmstH).toBeCloseTo(23.9942, 2);
    expect(t.ltstH).toBeCloseTo(23.6485, 2);
    expect(t.marsYear).toBe(24);
  });

  it('puts the Curiosity landing at about Ls 151, 15:00 local mean time, MSD 49269', () => {
    const t = marsTime(CURIOSITY_LANDING, GALE.lon);
    expect(t.sol).toBe(49269);
    expect(Math.abs(t.lsDeg - 151)).toBeLessThan(1);
    expect(clockDiff(t.lmstH, 15)).toBeLessThan(0.25);
    expect(t.marsYear).toBe(31);
  });

  it('puts the Perseverance landing at about Ls 5 in Mars year 36, mid-afternoon', () => {
    const t = marsTime(PERSEVERANCE_LANDING, JEZERO.lon);
    expect(Math.abs(t.lsDeg - 5)).toBeLessThan(1.5);
    expect(t.marsYear).toBe(36);
    expect(t.ltstH).toBeGreaterThan(15);
    expect(t.ltstH).toBeLessThan(16.3);
    expect(t.lmstH).toBeGreaterThan(15.5);
    expect(t.lmstH).toBeLessThan(16.3);
  });

  it('gives sol as the whole part of the Mars sol date', () => {
    for (const utc of [CURIOSITY_LANDING, PERSEVERANCE_LANDING, Date.UTC(2030, 5, 1, 13, 7)]) {
      const t = marsTime(utc, 0);
      expect(t.sol).toBe(Math.floor(t.msd));
    }
  });

  it('treats longitude as east-positive: 90 E is six hours ahead of the prime meridian', () => {
    const a = marsTime(PERSEVERANCE_LANDING, 0);
    const b = marsTime(PERSEVERANCE_LANDING, 90);
    expect(clockDiff(b.lmstH, a.lmstH + 6)).toBeLessThan(1e-9);
    expect(clockDiff(b.ltstH, a.ltstH + 6)).toBeLessThan(1e-9);
  });

  it('advances one sol of clock time in one sol', () => {
    const a = marsTime(PERSEVERANCE_LANDING, JEZERO.lon);
    const b = marsTime(PERSEVERANCE_LANDING + SOL_MS, JEZERO.lon);
    expect(b.msd - a.msd).toBeCloseTo(1, 6);
    expect(clockDiff(a.lmstH, b.lmstH)).toBeLessThan(1e-4);
  });

  it('starts Mars years 36 and 37 on the published dates', () => {
    const my36 = dateForLs(0, Date.UTC(2021, 0, 1));
    const my37 = dateForLs(0, PERSEVERANCE_LANDING);
    expect(Math.abs(my36 - Date.UTC(2021, 1, 7)) / 86_400_000).toBeLessThan(1.5);
    expect(Math.abs(my37 - Date.UTC(2022, 11, 26)) / 86_400_000).toBeLessThan(1.5);
    expect(marsTime(my37 + 3_600_000, 0).marsYear).toBe(37);
    expect(marsTime(my37 - 3_600_000, 0).marsYear).toBe(36);
  });
});

describe('sunPosition', () => {
  it('has the sun highest at local noon, due south or north, at 90 minus the gap to the subsolar latitude', () => {
    const noon = nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, 12);
    const sun = sunPosition(noon, JEZERO.lat, JEZERO.lon);
    // Just after the northern spring equinox the sun is about 2 degrees north of the equator.
    expect(sun.elevDeg).toBeGreaterThan(71);
    expect(sun.elevDeg).toBeLessThan(76);
    expect(Math.abs(sun.azDeg - 180)).toBeLessThan(0.5);
    const before = sunPosition(noon - 600_000, JEZERO.lat, JEZERO.lon);
    const after = sunPosition(noon + 600_000, JEZERO.lat, JEZERO.lon);
    expect(sun.elevDeg).toBeGreaterThan(before.elevDeg);
    expect(sun.elevDeg).toBeGreaterThan(after.elevDeg);
  });

  it('rises in the east and sets in the west, with azimuth clockwise from north', () => {
    const morning = sunPosition(nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, 8), JEZERO.lat, JEZERO.lon);
    const evening = sunPosition(nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, 16), JEZERO.lat, JEZERO.lon);
    const midnight = sunPosition(nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, 0), JEZERO.lat, JEZERO.lon);
    expect(morning.azDeg).toBeGreaterThan(45);
    expect(morning.azDeg).toBeLessThan(135);
    expect(evening.azDeg).toBeGreaterThan(225);
    expect(evening.azDeg).toBeLessThan(315);
    expect(morning.elevDeg).toBeGreaterThan(0);
    expect(midnight.elevDeg).toBeLessThan(-45);
  });

  it('keeps the noon sun near Jezero between about 46 and 90 degrees over a Mars year', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let day = 0; day < 687; day += 7) {
      const noon = nextLtst(PERSEVERANCE_LANDING + day * 86_400_000, JEZERO.lon, 12);
      const { elevDeg } = sunPosition(noon, JEZERO.lat, JEZERO.lon);
      lo = Math.min(lo, elevDeg);
      hi = Math.max(hi, elevDeg);
    }
    expect(lo).toBeGreaterThan(45.5);
    expect(lo).toBeLessThan(48);
    expect(hi).toBeGreaterThan(88);
    expect(hi).toBeLessThanOrEqual(90);
  });
});

describe('sunriseSunset', () => {
  it('gives about half a sol of daylight near the equator', () => {
    for (const day of [0, 170, 340, 510]) {
      const d = sunriseSunset(PERSEVERANCE_LANDING + day * 86_400_000, 0, 30);
      expect(d.dayLengthS / SOL_S).toBeGreaterThan(0.49);
      expect(d.dayLengthS / SOL_S).toBeLessThan(0.51);
      expect(d.dayLengthS).toBeCloseTo((d.setUtcMs - d.riseUtcMs) / 1000, 6);
    }
  });

  it('returns the sunrise and sunset of the local solar day that contains the moment', () => {
    const d = sunriseSunset(PERSEVERANCE_LANDING, JEZERO.lat, JEZERO.lon);
    // The landing was mid-afternoon: after sunrise, before sunset, both within the same sol.
    expect(d.riseUtcMs).toBeLessThan(PERSEVERANCE_LANDING);
    expect(d.setUtcMs).toBeGreaterThan(PERSEVERANCE_LANDING);
    expect(d.setUtcMs - d.riseUtcMs).toBeLessThan(SOL_MS);
    expect(Math.abs(sunPosition(d.riseUtcMs, JEZERO.lat, JEZERO.lon).elevDeg)).toBeLessThan(0.05);
    expect(Math.abs(sunPosition(d.setUtcMs, JEZERO.lat, JEZERO.lon).elevDeg)).toBeLessThan(0.05);
    expect(clockDiff(marsTime(d.riseUtcMs, JEZERO.lon).ltstH, 6)).toBeLessThan(0.5);
    expect(clockDiff(marsTime(d.setUtcMs, JEZERO.lon).ltstH, 18)).toBeLessThan(0.5);
  });

  it('gives the same day whichever moment of that day is asked', () => {
    const noon = nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, 12);
    const a = sunriseSunset(noon - 5 * 3_600_000, JEZERO.lat, JEZERO.lon);
    const b = sunriseSunset(noon + 9 * 3_600_000, JEZERO.lat, JEZERO.lon);
    expect(Math.abs(a.riseUtcMs - b.riseUtcMs)).toBeLessThan(2000);
    expect(Math.abs(a.setUtcMs - b.setUtcMs)).toBeLessThan(2000);
  });

  it('has longer days in northern summer than in northern winter at Jezero', () => {
    const summer = sunriseSunset(dateForLs(90, PERSEVERANCE_LANDING), JEZERO.lat, JEZERO.lon);
    const winter = sunriseSunset(dateForLs(270, PERSEVERANCE_LANDING), JEZERO.lat, JEZERO.lon);
    expect(summer.dayLengthS).toBeGreaterThan(winter.dayLengthS + 3600);
  });

  it('reports no daylight in polar night and a full sol in polar day without throwing', () => {
    const winter = dateForLs(270, PERSEVERANCE_LANDING);
    expect(sunriseSunset(winter, 85, 0).dayLengthS).toBe(0);
    expect(sunriseSunset(winter, -85, 0).dayLengthS).toBeCloseTo(SOL_S, 3);
  });

  it('finds the next sunrise after a moment', () => {
    const today = sunriseSunset(PERSEVERANCE_LANDING, JEZERO.lat, JEZERO.lon);
    const next = nextSunrise(PERSEVERANCE_LANDING, JEZERO.lat, JEZERO.lon);
    expect(next).toBeGreaterThan(PERSEVERANCE_LANDING);
    expect(Math.abs(next - today.riseUtcMs - SOL_MS)).toBeLessThan(120_000);
    expect(nextSunrise(today.riseUtcMs - 60_000, JEZERO.lat, JEZERO.lon)).toBeCloseTo(today.riseUtcMs, -3);
  });
});

describe('lightTimeS', () => {
  it('matches the one-way delay reported at the Perseverance and Curiosity landings', () => {
    // 11 min 22 s on 2021-02-18 and 13 min 48 s on 2012-08-06, as reported by JPL at the time.
    expect(Math.abs(lightTimeS(PERSEVERANCE_LANDING) - 682)).toBeLessThan(15);
    expect(Math.abs(lightTimeS(CURIOSITY_LANDING) - 828)).toBeLessThan(15);
  });

  it('stays between about 3 and 22.5 minutes', () => {
    for (let day = 0; day < 6000; day += 23) {
      const s = lightTimeS(CURIOSITY_LANDING + day * 86_400_000);
      expect(s).toBeGreaterThan(180);
      expect(s).toBeLessThan(1350);
    }
  });
});

describe('dateForLs', () => {
  it('returns the next moment the season reaches the asked solar longitude', () => {
    for (const ls of [0, 45, 90, 180, 251, 359.5]) {
      const t = dateForLs(ls, PERSEVERANCE_LANDING);
      expect(t).toBeGreaterThanOrEqual(PERSEVERANCE_LANDING);
      expect(t - PERSEVERANCE_LANDING).toBeLessThan(688 * 86_400_000);
      const got = marsTime(t, 0).lsDeg;
      expect(Math.min(Math.abs(got - ls), 360 - Math.abs(got - ls))).toBeLessThan(1e-3);
    }
  });

  it('accepts a longitude outside 0 to 360', () => {
    expect(dateForLs(450, PERSEVERANCE_LANDING)).toBeCloseTo(dateForLs(90, PERSEVERANCE_LANDING), -2);
  });
});

describe('nextLtst', () => {
  it('returns the next moment local true solar time reads the asked hour', () => {
    for (const h of [0, 6.5, 12, 15.9, 23.75]) {
      const t = nextLtst(PERSEVERANCE_LANDING, JEZERO.lon, h);
      expect(t).toBeGreaterThanOrEqual(PERSEVERANCE_LANDING);
      expect(t - PERSEVERANCE_LANDING).toBeLessThan(SOL_MS + 60_000);
      expect(clockDiff(marsTime(t, JEZERO.lon).ltstH, h)).toBeLessThan(1e-4);
    }
  });
});
