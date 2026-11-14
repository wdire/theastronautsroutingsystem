import { describe, expect, it } from 'vitest';
import { mapLighting } from './lighting';

describe('map lighting', () => {
  it('points the shading at the sun and clamps its height to 8 to 70 degrees', () => {
    expect(mapLighting(45, 120).direction).toBe(120);
    expect(mapLighting(45, -30).direction).toBe(330);
    expect(mapLighting(85, 0).height).toBe(70);
    expect(mapLighting(2, 0).height).toBe(8);
    expect(mapLighting(-30, 0).height).toBe(8);
  });

  it('shades 0.55 at noon and 0.85 at the horizon', () => {
    expect(mapLighting(80, 0).strength).toBeCloseTo(0.55);
    expect(mapLighting(0, 0).strength).toBeCloseTo(0.85);
    const mid = mapLighting(39, 0).strength;
    expect(mid).toBeGreaterThan(0.55);
    expect(mid).toBeLessThan(0.85);
  });

  it('dims the imagery: 1 by day, 0.82 near sunset, 0.4 at night', () => {
    expect(mapLighting(40, 0).brightness).toBeCloseTo(1);
    expect(mapLighting(0, 0).brightness).toBeCloseTo(0.82);
    expect(mapLighting(-20, 0).brightness).toBeCloseTo(0.4);
    let prev = mapLighting(-20, 0).brightness;
    for (let e = -20; e <= 40; e += 0.5) {
      const b = mapLighting(e, 0).brightness;
      expect(b).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = b;
    }
  });

  it('names the phase and gives colours for every input', () => {
    expect(mapLighting(30, 0).phase).toBe('day');
    expect(mapLighting(0, 0).phase).toBe('twilight');
    expect(mapLighting(-10, 0).phase).toBe('night');
    expect(mapLighting(30, 0).sky).toBe('rgb(214 170 122)');
    expect(mapLighting(-30, 0).sky).toBe('rgb(10 9 12)');
    expect(mapLighting(Number.NaN, Number.NaN).sky).toMatch(/^rgb\(/);
  });
});
