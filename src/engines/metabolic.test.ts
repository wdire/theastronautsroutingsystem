import { describe, expect, it } from 'vitest';
import { o2KgPerHour, SEATED_W, STANDING_W, walkingW, WORK_W } from './metabolic';
import { toblerKmh } from './vehicles';

const FLAT = walkingW(3.3, 0);

describe('walkingW', () => {
  it('is about 250 W on the flat at the 3.3 km/h suit pace', () => {
    expect(Math.abs(FLAT - 250) / 250).toBeLessThan(0.05);
  });

  it('costs over 1.8 times the flat on a 10 degree climb, even at the slower pace the slope allows', () => {
    expect(walkingW(toblerKmh(10), 10)).toBeGreaterThan(1.8 * FLAT);
    expect(walkingW(3.3, 10)).toBeGreaterThan(1.8 * FLAT);
  });

  it('is cheaper than the flat on a gentle descent', () => {
    expect(walkingW(3.3, -3)).toBeLessThan(FLAT);
    expect(walkingW(3.3, -5)).toBeLessThan(FLAT);
    expect(walkingW(toblerKmh(-3), -3)).toBeLessThan(FLAT);
  });

  it('is dearer than the flat on a steep descent', () => {
    expect(walkingW(3.3, -20)).toBeGreaterThan(FLAT);
    expect(walkingW(toblerKmh(-20), -20)).toBeGreaterThan(FLAT);
  });

  it('stays a sane working rate on the steepest ground a walker can take', () => {
    // Santee's downhill fit carried past its range would give over 2 kW here.
    expect(walkingW(toblerKmh(-24.9), -24.9)).toBeLessThan(800);
    expect(walkingW(toblerKmh(24.9), 24.9)).toBeLessThan(800);
  });

  it('never falls below standing', () => {
    expect(walkingW(0, 0)).toBeCloseTo(STANDING_W, 9);
    for (const grade of [-25, -12, -6, -3, 0, 3, 12, 25]) {
      for (const speed of [0, 0.3, 1, 2, 3.3, 5]) {
        expect(walkingW(speed, grade)).toBeGreaterThanOrEqual(STANDING_W);
      }
    }
  });

  it('rises with speed on the flat and with the steepness of a climb', () => {
    expect(walkingW(2, 0)).toBeLessThan(walkingW(3, 0));
    expect(walkingW(3, 0)).toBeLessThan(walkingW(4, 0));
    expect(walkingW(3, 2)).toBeLessThan(walkingW(3, 5));
    expect(walkingW(3, 5)).toBeLessThan(walkingW(3, 15));
  });

  it('has no jump where downhill meets the flat', () => {
    expect(Math.abs(walkingW(3.3, -0.001) - walkingW(3.3, 0))).toBeLessThan(0.5);
    expect(Math.abs(walkingW(3.3, 0.001) - walkingW(3.3, 0))).toBeLessThan(0.5);
  });

  it('treats a negative or missing speed as standing still', () => {
    expect(walkingW(-2, 0)).toBeCloseTo(STANDING_W, 9);
    expect(walkingW(Number.NaN, 0)).toBeCloseTo(STANDING_W, 9);
    expect(Number.isFinite(walkingW(3, Number.NaN))).toBe(true);
  });
});

describe('fixed rates', () => {
  it('uses 150 W seated, 300 W working, and a standing rate below both', () => {
    expect(SEATED_W).toBe(150);
    expect(WORK_W).toBe(300);
    expect(STANDING_W).toBeGreaterThan(100);
    expect(STANDING_W).toBeLessThan(SEATED_W);
  });
});

describe('o2KgPerHour', () => {
  it('is 0.075 kg/h at 250 W and proportional to the work rate', () => {
    expect(o2KgPerHour(250)).toBeCloseTo(0.075, 12);
    expect(o2KgPerHour(500)).toBeCloseTo(0.15, 12);
    expect(o2KgPerHour(0)).toBe(0);
    expect(o2KgPerHour(-50)).toBe(0);
  });

  it('makes a 0.9 kg suit tank last 12 hours at 250 W', () => {
    expect(0.9 / o2KgPerHour(250)).toBeCloseTo(12, 9);
  });
});
