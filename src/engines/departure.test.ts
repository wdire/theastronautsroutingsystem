import { describe, expect, it } from 'vitest';
import { AFTER_SUNRISE_MS, BEFORE_SUNSET_MS, daylightDeparture } from './departure';
import { nextLtst, nextSunrise, SOL_MS, sunPosition, sunriseSunset } from './marsTime';

// Jezero, a few days after Perseverance landed: about 12 hours of light.
const LON = 77.45;
const LAT = 18.44;
const BASE = Date.UTC(2021, 1, 20);
const H = 3600;

describe('daylightDeparture', () => {
  it('leaves a trip that ends in daylight alone', () => {
    const planned = nextLtst(BASE, LON, 9);
    const r = daylightDeparture(planned, 2 * H, LAT, LON);
    expect(r).toEqual({ departUtcMs: planned, fits: true, moved: false });
  });

  it('moves a trip that would end after dark to 30 minutes after the next sunrise', () => {
    const planned = nextLtst(BASE, LON, 16);
    const r = daylightDeparture(planned, 4 * H, LAT, LON);
    const rise = nextSunrise(planned, LAT, LON);
    expect(r.departUtcMs).toBeCloseTo(rise + AFTER_SUNRISE_MS, -1);
    expect(r.fits).toBe(true);
    expect(r.moved).toBe(true);
    expect(r.departUtcMs).toBeGreaterThan(planned);
    expect(sunPosition(r.departUtcMs, LAT, LON).elevDeg).toBeGreaterThan(0);
    const set = sunriseSunset(r.departUtcMs, LAT, LON).setUtcMs;
    expect(r.departUtcMs + 4 * H * 1000).toBeLessThanOrEqual(set - BEFORE_SUNSET_MS);
  });

  it('moves a short trip planned before dawn to the same morning, not the next', () => {
    const planned = nextLtst(BASE, LON, 5);
    const r = daylightDeparture(planned, 0.5 * H, LAT, LON);
    expect(r.fits).toBe(true);
    expect(r.departUtcMs).toBeCloseTo(nextSunrise(planned, LAT, LON) + AFTER_SUNRISE_MS, -1);
    expect(r.departUtcMs - planned).toBeLessThan(2 * H * 1000);
  });

  it('does not accept a start in the dark just because the trip ends after sunrise', () => {
    // 04:00 local solar time with a 3 hour walk: it would end in daylight, but two hours of it are walked blind.
    const planned = nextLtst(BASE, LON, 4);
    const r = daylightDeparture(planned, 3 * H, LAT, LON);
    const rise = nextSunrise(planned, LAT, LON);
    expect(r.moved).toBe(true);
    expect(r.fits).toBe(true);
    // The same sunrise found from two starting points agrees to a fraction of a millisecond, not exactly.
    expect(Math.abs(r.departUtcMs - (rise + AFTER_SUNRISE_MS))).toBeLessThan(1000);
    expect(sunPosition(r.departUtcMs, LAT, LON).elevDeg).toBeGreaterThan(0);
  });

  it('does not accept a trip that runs through a night and happens to end the next day', () => {
    // 15:00 with a 20 hour trip ends at about 11:00 the next sol, in daylight, after a whole night out.
    const planned = nextLtst(BASE, LON, 15);
    const r = daylightDeparture(planned, 20 * H, LAT, LON);
    expect(r.fits).toBe(false);
  });

  it('reports a trip longer than a day of light as not fitting', () => {
    const planned = nextLtst(BASE, LON, 10);
    const day = sunriseSunset(planned, LAT, LON);
    expect(day.dayLengthS).toBeLessThan(13 * H);
    const r = daylightDeparture(planned, 13 * H, LAT, LON);
    expect(r.fits).toBe(false);
    const rise = nextSunrise(planned, LAT, LON);
    expect(r.departUtcMs).toBeCloseTo(rise + AFTER_SUNRISE_MS, -1);
    expect(r.departUtcMs - planned).toBeLessThan(SOL_MS);
  });

  it('copes with junk durations and times', () => {
    const planned = nextLtst(BASE, LON, 11);
    expect(daylightDeparture(planned, Number.NaN, LAT, LON)).toEqual({ departUtcMs: planned, fits: true, moved: false });
    expect(daylightDeparture(planned, -5, LAT, LON).departUtcMs).toBe(planned);
    expect(Number.isFinite(daylightDeparture(Number.NaN, H, LAT, LON).departUtcMs)).toBe(true);
  });
});
