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
    expect(reliefExaggeration(15)).toBeCloseTo(1.6);
    expect(reliefExaggeration(15.75)).toBeCloseTo(1.3);
    // Close in, over the HiRISE model, the map is at true scale.
    expect(reliefExaggeration(17)).toBeCloseTo(1);
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
