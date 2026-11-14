import { describe, expect, it } from 'vitest';
import { gradeColour, gradeGain, gradePixels } from './grading';

const lum = (c: readonly number[]) => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

describe('ground grading', () => {
  it('follows the gain curve from the spec', () => {
    expect(gradeGain(0)).toBeCloseTo(0.5);
    expect(gradeGain(0.25)).toBeCloseTo(0.5 + 1.15 * 0.25);
    expect(gradeGain(1)).toBeCloseTo(0.5 + 1.15 / (1 + 1.2 * 0.75));
  });

  it('turns maroon orbital colour toward butterscotch: red over green over blue, not purple', () => {
    const [r, g, b] = gradeColour(0.45, 0.22, 0.2);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // Green is lifted relative to red: the maroon cast is gone.
    expect(g / r).toBeGreaterThan(0.22 / 0.45 + 0.1);
  });

  it('keeps darker ground darker and never clips pale ground to white', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const out = lum(gradeColour(v, v * 0.8, v * 0.65));
      expect(out).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = out;
    }
    const pale = gradeColour(1, 0.95, 0.9);
    expect(Math.max(...pale)).toBeLessThanOrEqual(1);
    expect(pale[2]).toBeLessThan(0.9);
    // Shadow is dark dust, not black: half-bright butterscotch.
    const dark = gradeColour(0, 0, 0);
    expect(dark[0]).toBeCloseTo(0.42);
    expect(dark[2]).toBeCloseTo(0.225);
  });

  it('does not blow a faint tint in a dark pixel up into a saturated colour', () => {
    // Nearly black with a little more red, and with a little more green: both must stay dusty.
    for (const dark of [[0.06, 0.02, 0.02], [0.02, 0.05, 0.02]] as const) {
      const [r, g, b] = gradeColour(dark[0], dark[1], dark[2]);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(r - b).toBeLessThan(0.3);
    }
  });

  it('grades pixels in place and leaves alpha alone', () => {
    const px = new Uint8ClampedArray([115, 56, 51, 200]);
    gradePixels(px);
    expect(px[3]).toBe(200);
    expect(px[0]).toBeGreaterThan(px[1] ?? 0);
    expect(px[1]).toBeGreaterThan(56);
  });
});
