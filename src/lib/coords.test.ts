import { describe, expect, it } from 'vitest';
import { parseCoordinates } from './coords';

describe('parseCoordinates', () => {
  it('reads latitude then longitude by default', () => {
    expect(parseCoordinates('18.4446, 77.4509')).toEqual({ lat: 18.4446, lon: 77.4509 });
    expect(parseCoordinates('18.4446 77.4509')).toEqual({ lat: 18.4446, lon: 77.4509 });
    expect(parseCoordinates('  -4.59 ,137.44 ')).toEqual({ lat: -4.59, lon: 137.44 });
  });

  it('follows hemisphere letters in either order', () => {
    expect(parseCoordinates('18.44° N, 77.45° E')).toEqual({ lat: 18.44, lon: 77.45 });
    expect(parseCoordinates('77.45E 18.44N')).toEqual({ lat: 18.44, lon: 77.45 });
    expect(parseCoordinates('4.59 S 137.44 E')).toEqual({ lat: -4.59, lon: 137.44 });
    expect(parseCoordinates('18.44 N 10 W')).toEqual({ lat: 18.44, lon: -10 });
  });

  it('accepts a typographic minus and wraps longitudes past 180', () => {
    expect(parseCoordinates('−4.59, 137.44')).toEqual({ lat: -4.59, lon: 137.44 });
    expect(parseCoordinates('10, 282.5')).toEqual({ lat: 10, lon: -77.5 });
  });

  it('rejects text that is not a coordinate pair', () => {
    for (const text of ['', 'Jezero', '18.44', '95, 10', '10 N 20 N', '10 E 20 W', '1 2 3', 'abc, def', '18.44,']) {
      expect(parseCoordinates(text)).toBeNull();
    }
  });
});
