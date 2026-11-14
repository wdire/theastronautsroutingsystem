import { describe, expect, it } from 'vitest';
import { cutoffForSourceZoom, HIRISE_CUTOFF_M, planetMetres, reliefAt, type ReliefSample } from './relief';

const sample = (): ReliefSample => ({ h: 0, sand: 0, rock: 0 });
const [X0, Z0] = planetMetres(77.44, 18.45);

describe('reliefAt', () => {
  it('is a pure function of place', () => {
    const a = reliefAt(X0 + 123.4, Z0 - 56.7, 1.6, 600, sample());
    const b = reliefAt(X0 + 123.4, Z0 - 56.7, 1.6, 600, sample());
    expect(a).toEqual(b);
  });

  it('adds nothing when the data is already finer than the layer can draw', () => {
    const r = reliefAt(X0, Z0, 16, 10, sample());
    expect(r.h).toBe(0);
    expect(r.sand).toBe(0);
    expect(r.rock).toBe(0);
  });

  it('invents far less on HiRISE ground than on 200 m ground', () => {
    let coarse = 0;
    let fine = 0;
    for (let i = 0; i < 400; i += 1) {
      const x = X0 + (i % 20) * 7.3;
      const z = Z0 + Math.floor(i / 20) * 7.3;
      coarse += Math.abs(reliefAt(x, z, 1.6, cutoffForSourceZoom(9), sample()).h);
      fine += Math.abs(reliefAt(x, z, 1.6, HIRISE_CUTOFF_M, sample()).h);
    }
    expect(fine / 400).toBeLessThan(0.08);
    expect(coarse / 400).toBeGreaterThan(fine / 400 * 10);
  });

  it('keeps heights, sand and rock in sensible ranges', () => {
    for (let i = 0; i < 2000; i += 1) {
      const r = reliefAt(X0 + i * 13.7, Z0 - i * 9.1, 1.6, 600, sample());
      expect(Number.isFinite(r.h)).toBe(true);
      expect(Math.abs(r.h)).toBeLessThan(80);
      expect(r.sand).toBeGreaterThanOrEqual(0);
      expect(r.sand).toBeLessThanOrEqual(1);
      expect(r.rock).toBeGreaterThanOrEqual(0);
      expect(r.rock).toBeLessThanOrEqual(1);
    }
  });

  it('cuts bowls into 200 m ground: some points lie well below the ring of ground around them', () => {
    const h = (x: number, z: number) => reliefAt(x, z, 1.6, 600, sample()).h;
    let deepest = 0;
    for (let i = 0; i < 3000; i += 1) {
      const x = X0 + (i % 60) * 4;
      const z = Z0 + Math.floor(i / 60) * 4;
      let ring = 0;
      for (let k = 0; k < 8; k += 1) ring += h(x + Math.cos((k * Math.PI) / 4) * 4, z + Math.sin((k * Math.PI) / 4) * 4) / 8;
      deepest = Math.min(deepest, h(x, z) - ring);
    }
    expect(deepest).toBeLessThan(-0.2);
  });
});
