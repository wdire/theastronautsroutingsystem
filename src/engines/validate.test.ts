import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareTracks, legTrack, M20_LEGS } from './validate';
import type { Traverse } from './validate';
import { pathLengthM } from './terrain';
import { MARS_RADIUS_M } from '../lib/constants';
import type { PathPoint } from './types';

const m20 = JSON.parse(readFileSync(new URL('../../public/data/traverses/m20.json', import.meta.url), 'utf8')) as Traverse;

/** Move a track north by a distance. */
function shiftNorth(path: readonly PathPoint[], m: number): PathPoint[] {
  const dLat = (m / MARS_RADIUS_M) * (180 / Math.PI);
  return path.map((p) => [p[0], p[1] + dLat, p[2]] as const);
}

describe('M20_LEGS', () => {
  it('has the five legs with plain names', () => {
    expect(M20_LEGS.map((l) => [l.fromSol, l.toSol])).toEqual([
      [13, 199],
      [350, 419],
      [694, 925],
      [1063, 1429],
      [1429, 2022],
    ]);
    expect(new Set(M20_LEGS.map((l) => l.id)).size).toBe(5);
    for (const l of M20_LEGS) expect(l.description.length).toBeGreaterThan(20);
  });
});

describe('legTrack', () => {
  it('cuts a real piece of the drive for every leg, in order', () => {
    let lastEnd = -1;
    for (const leg of M20_LEGS) {
      const track = legTrack(m20, leg);
      expect(track.length, leg.id).toBeGreaterThan(50);
      expect(pathLengthM(track), leg.id).toBeGreaterThan(1000);
      const first = m20.path.indexOf(track[0]!);
      expect(first, leg.id).toBeGreaterThanOrEqual(lastEnd);
      lastEnd = first + track.length - 1;
    }
  });

  it('starts and ends near the waypoints of the leg', () => {
    const leg = M20_LEGS[2]!;
    const track = legTrack(m20, leg);
    const a = m20.waypoints.find((w) => w.sol === leg.fromSol)!;
    const b = m20.waypoints.find((w) => w.sol === leg.toSol)!;
    expect(pathLengthM([track[0]!, [a.lon, a.lat]])).toBeLessThan(30);
    expect(pathLengthM([track[track.length - 1]!, [b.lon, b.lat]])).toBeLessThan(30);
  });
});

describe('compareTracks', () => {
  const real = m20.path;

  it('gives about 0 m and 100% for a track against itself', () => {
    const c = compareTracks(real, real);
    expect(c.medianM).toBeLessThan(5);
    expect(c.p90M).toBeLessThan(11);
    expect(c.within300Frac).toBe(1);
    expect(c.plannedLengthM).toBeCloseTo(c.realLengthM, 6);
    expect(c.samples).toBeGreaterThan(800);
  });

  it('gives about 1000 m and 0% for a straight track shifted 1 km', () => {
    const line: PathPoint[] = Array.from({ length: 101 }, (_, i) => [77.3 + i * 0.001, 18.45, -2500] as const);
    const c = compareTracks(shiftNorth(line, 1000), line);
    expect(c.medianM).toBeCloseTo(1000, -1);
    expect(c.p90M).toBeCloseTo(1000, -1);
    expect(c.within300Frac).toBe(0);
  });

  it('puts every leg of the real drive shifted 1 km well away from itself', () => {
    // The real legs wind and run north-south in places, so a shifted copy passes near other parts of the
    // original: the distance can never exceed the 1 km shift, but the median sits below it.
    for (const leg of M20_LEGS) {
      const track = legTrack(m20, leg);
      const c = compareTracks(shiftNorth(track, 1000), track);
      expect(c.p90M, leg.id).toBeGreaterThan(900);
      expect(c.p90M, leg.id).toBeLessThanOrEqual(1001);
      expect(c.medianM, leg.id).toBeGreaterThan(400);
      expect(c.within300Frac, leg.id).toBeLessThan(0.4);
    }
  });

  it('is quick on the full 12,000-point track', () => {
    const t0 = performance.now();
    compareTracks(shiftNorth(real, 1000), real);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('returns NaN distances for empty input', () => {
    const c = compareTracks([], real);
    expect(c.samples).toBe(0);
    expect(Number.isNaN(c.medianM)).toBe(true);
  });
});
