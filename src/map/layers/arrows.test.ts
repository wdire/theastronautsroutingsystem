import { describe, expect, it } from 'vitest';
import type { PathPoint } from '@/engines/types';
import { arrowPoints } from './arrows';

// About 59 m a step (Mars) east along the equator, then back west.
const east: PathPoint[] = Array.from({ length: 11 }, (_, i) => [i * 0.001, 0, 0]);
const west: PathPoint[] = [...east].reverse();

describe('arrowPoints', () => {
  it('puts a chevron in the middle of each leg, pointing the way the leg goes', () => {
    const path = [...east, ...west.slice(1)];
    const pts = arrowPoints(path, [0, 10, 20]);
    expect(pts).toHaveLength(2);
    expect(pts[0]?.properties.bearing).toBeCloseTo(90, 0);
    expect(pts[1]?.properties.bearing).toBeCloseTo(270, 0);
    expect(pts[0]?.geometry.coordinates[0]).toBeCloseTo(0.005, 4);
  });

  it('adds more along a long leg and none on a very short one', () => {
    const long: PathPoint[] = Array.from({ length: 41 }, (_, i) => [i * 0.001, 0, 0]);
    // 40 steps of 59 m: 2.4 km, two chevrons at 900 m apart or more.
    expect(arrowPoints(long, [0, 40]).length).toBe(2);
    expect(arrowPoints([[0, 0, 0], [0.0001, 0, 0]], [0, 1])).toHaveLength(0);
  });
});
