import { describe, expect, it } from 'vitest';
import { blendDetail, blur, highPassRadius, luminance } from './detail';

describe('live detail', () => {
  it('scales the high-pass radius with the upsampling, within 2 to 48 px', () => {
    expect(highPassRadius(9, 8)).toBe(3);
    expect(highPassRadius(11, 8)).toBe(12);
    expect(highPassRadius(12, 8)).toBe(24);
    expect(highPassRadius(8, 8)).toBe(2);
    expect(highPassRadius(17, 8)).toBe(48);
  });

  it('computes luminance', () => {
    expect(Array.from(luminance(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255])))).toEqual([255, 0]);
  });

  it('blur keeps a flat field flat and preserves the mean of a spike', () => {
    const w = 40;
    const flat = new Float32Array(w * w).fill(90);
    expect(Math.max(...blur(flat, w, w, 6))).toBeCloseTo(90, 3);
    expect(Math.min(...blur(flat, w, w, 6))).toBeCloseTo(90, 3);
    const spike = new Float32Array(w * w);
    spike[20 * w + 20] = 1000;
    const out = blur(spike, w, w, 4);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 0);
    expect(out[20 * w + 20] ?? 0).toBeLessThan(200);
  });

  it('leaves the base untouched where the detail is flat or masked out', () => {
    const size = 16;
    const pad = 4;
    const full = size + 2 * pad;
    const base = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < base.length; i += 4) base.set([150, 96, 62, 255], i);
    const before = Uint8ClampedArray.from(base);

    blendDetail(base, size, pad, [{ lum: new Float32Array(full * full).fill(120), radius: 6, gain: 1 }]);
    expect(base).toEqual(before);

    const noisy = Float32Array.from({ length: full * full }, (_, i) => (i % 2 ? 250 : 5));
    blendDetail(base, size, pad, [{ lum: noisy, mask: new Float32Array(full * full), radius: 6, gain: 1 }]);
    expect(base).toEqual(before);
  });

  it('adds texture without changing the average colour much, and never overflows', () => {
    const size = 32;
    const pad = 8;
    const full = size + 2 * pad;
    const base = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < base.length; i += 4) base.set([150, 96, 62, 255], i);
    const stripes = Float32Array.from({ length: full * full }, (_, i) => (Math.floor((i % full) / 2) % 2 ? 230 : 20));
    blendDetail(base, size, pad, [{ lum: stripes, radius: 12, gain: 1 }]);
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < base.length; i += 4) {
      const r = base[i] ?? 0;
      sum += r;
      min = Math.min(min, r);
      max = Math.max(max, r);
      expect(base[i + 3]).toBe(255);
    }
    expect(max - min).toBeGreaterThan(40);
    expect(Math.abs(sum / (size * size) - 150)).toBeLessThan(25);
  });
});
