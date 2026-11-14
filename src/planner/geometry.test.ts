import { describe, expect, it } from 'vitest';
import { gradesAlong, pathStats, shapeOnlyTrip } from './geometry';
import type { PathPoint } from '@/engines/types';

// One degree of latitude on Mars is 59,274.7 m.
const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const north = (metres: number, elev: number): PathPoint => [77.4, 18.4 + metres / M_PER_DEG, elev];

describe('path geometry', () => {
  it('measures length, climb and descent', () => {
    const s = pathStats([north(0, 0), north(1000, 50), north(2000, 20), north(3000, 20)]);
    expect(s.distM).toBeCloseTo(3000, 0);
    expect(s.climbM).toBeCloseTo(50);
    expect(s.descentM).toBeCloseTo(30);
    expect(Array.from(s.along).map(Math.round)).toEqual([0, 1000, 2000, 3000]);
  });

  it('measures the steepest stretch over a base length, not one noisy step', () => {
    // 100 m at 10 degrees is steep; a 2 m step over 1 m of ground is noise and must not dominate.
    const rise = Math.tan((10 * Math.PI) / 180) * 100;
    const path = [north(0, 0), north(50, rise / 2), north(100, rise), north(200, rise), north(201, rise + 2), north(300, rise + 2)];
    const s = pathStats(path, 60);
    expect(s.maxGradeDeg).toBeGreaterThan(9.5);
    expect(s.maxGradeDeg).toBeLessThan(12);
  });

  it('signs the grade by the direction of travel', () => {
    const path = [north(0, 0), north(100, 10), north(200, 20), north(300, 10), north(400, 0)];
    const g = gradesAlong(path, pathStats(path).along, 60);
    expect(g[1]).toBeGreaterThan(4);
    expect(g[4]).toBeLessThan(-4);
  });

  it('copes with empty paths and repeated points', () => {
    expect(pathStats([]).distM).toBe(0);
    expect(pathStats([north(0, 5)]).maxGradeDeg).toBe(0);
    const s = pathStats([north(0, 5), north(0, 5), north(0, 5)]);
    expect(s.distM).toBe(0);
    expect(Number.isFinite(s.maxGradeDeg)).toBe(true);
    expect(shapeOnlyTrip([]).totals.distM).toBe(0);
  });
});
