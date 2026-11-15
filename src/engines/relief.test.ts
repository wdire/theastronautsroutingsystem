import { describe, expect, it } from 'vitest';
import { reliefExaggeration, reliefLabel } from './relief';

describe('relief curve', () => {
  it('follows the stops from the spec', () => {
    expect(reliefExaggeration(0)).toBe(1);
    expect(reliefExaggeration(6)).toBe(1);
    expect(reliefExaggeration(8)).toBeCloseTo(2.2);
    expect(reliefExaggeration(9.5)).toBeCloseTo(3);
    expect(reliefExaggeration(10.5)).toBeCloseTo(3);
    expect(reliefExaggeration(11.5)).toBeCloseTo(3);
    expect(reliefExaggeration(13)).toBeCloseTo(2.2);
    expect(reliefExaggeration(15)).toBeCloseTo(1.8);
    expect(reliefExaggeration(15.75)).toBeCloseTo(1.65);
    // Close in, over the HiRISE model, a modest stretch keeps the ground standing up.
    expect(reliefExaggeration(16.5)).toBeCloseTo(1.5);
    expect(reliefExaggeration(19)).toBeCloseTo(1.4);
  });

  it('is continuous and stays between 1 and 3', () => {
    let prev = reliefExaggeration(0);
    for (let z = 0; z <= 17; z += 0.05) {
      const v = reliefExaggeration(z);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      expect(Math.abs(v - prev)).toBeLessThan(0.06);
      prev = v;
    }
    expect(reliefExaggeration(Number.NaN)).toBe(1);
  });

  it('labels the exaggeration, and says so when there is none', () => {
    expect(reliefLabel(3)).toBe('Relief x3.0 exaggerated');
    expect(reliefLabel(2.2)).toBe('Relief x2.2 exaggerated');
    expect(reliefLabel(1)).toBe('Relief at true scale');
  });
});
