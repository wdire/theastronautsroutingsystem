import { describe, expect, it } from 'vitest';
import { seatOnWheels } from './props';

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
