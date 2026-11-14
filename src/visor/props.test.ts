import { describe, expect, it } from 'vitest';
import { keepOutside, seatOnWheels } from './props';

describe('seatOnWheels', () => {
  it('stands level on flat ground', () => {
    expect(seatOnWheels([5, 5, 5, 5], 2, 3)).toEqual({ y: 5, pitch: 0, roll: 0 });
  });
  it('noses up a slope by the slope angle and stays on it', () => {
    // Front wheels 0.3 m higher over a 3 m wheelbase.
    const s = seatOnWheels([0.3, 0.3, 0, 0], 2, 3);
    expect(s.pitch).toBeCloseTo(Math.atan2(0.3, 3), 6);
    expect(s.roll).toBe(0);
    expect(s.y).toBeCloseTo(0.15, 6);
  });
  it('leans toward the low side', () => {
    const s = seatOnWheels([0, 0.4, 0, 0.4], 2, 3);
    expect(s.roll).toBeCloseTo(Math.atan2(0.4, 2), 6);
    expect(s.pitch).toBe(0);
  });
  it('rests on the higher wheels when one stands on a rock: no wheel is under the ground', () => {
    const heights: [number, number, number, number] = [0.4, 0, 0, 0];
    const s = seatOnWheels(heights, 2, 3);
    // Height of the tilted body's plane at each wheel must be at or above the ground there.
    const plane = (f: number, r: number) => s.y + (f * Math.tan(s.pitch) * 3) / 2 + (r * Math.tan(s.roll) * 2) / 2;
    const corners: [number, number][] = [[1, -1], [1, 1], [-1, -1], [-1, 1]];
    corners.forEach(([f, r], i) => expect(plane(f, r)).toBeGreaterThanOrEqual((heights[i] ?? 0) - 1e-9));
    // And it is not floating: one wheel touches.
    expect(Math.min(...corners.map(([f, r], i) => plane(f, r) - (heights[i] ?? 0)))).toBeCloseTo(0, 6);
  });
});

describe('keepOutside', () => {
  const rover = [{ x: 10, z: 0, r: 3 }];
  it('leaves a walker alone outside the disc', () => {
    expect(keepOutside(0, 0, rover)).toEqual([0, 0]);
    expect(keepOutside(13, 0, rover)).toEqual([13, 0]);
  });
  it('puts a walker who stepped in back on the edge, on the side they came from', () => {
    const [x, z] = keepOutside(8, 0, rover);
    expect(x).toBeCloseTo(7, 9);
    expect(z).toBeCloseTo(0, 9);
    const [x2, z2] = keepOutside(10, 1, rover);
    expect(Math.hypot(x2 - 10, z2)).toBeCloseTo(3, 9);
    expect(z2).toBeGreaterThan(0);
  });
  it('still finds a way out from dead centre, and honours the slack', () => {
    const [x, z] = keepOutside(10, 0, rover);
    expect(Math.hypot(x - 10, z)).toBeCloseTo(3, 9);
    expect(keepOutside(8, 0, rover, 0.5)).toEqual([8, 0]);
  });
});
