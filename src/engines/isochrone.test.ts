import { describe, expect, it } from 'vitest';
import { contour, suitPaceKmh, walkingField } from './isochrone';
import { flatGrid, haversineM, slopedGrid, syntheticGrid } from './terrain';
import type { Grid, LonLat } from './types';

function centre(grid: Grid): LonLat {
  return [grid.lonOf((grid.cols - 1) / 2), grid.latOf((grid.rows - 1) / 2)];
}

/** Is a point inside a closed ring (ray casting)? */
function within(ring: LonLat[], p: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as LonLat;
    const b = ring[j] as LonLat;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

describe('suitPaceKmh', () => {
  it('is Tobler scaled to 3.3 km/h on the flat, blocked at 25 degrees', () => {
    expect(suitPaceKmh(0)).toBeCloseTo(3.3, 10);
    expect(suitPaceKmh(10)).toBeLessThan(suitPaceKmh(-10));
    expect(suitPaceKmh(10)).toBeCloseTo(1.78, 2);
    // The suit caps the pace: a gentle descent is no faster than the flat.
    for (let g = -24; g <= 24; g += 0.5) expect(suitPaceKmh(g)).toBeLessThanOrEqual(3.3);
    expect(suitPaceKmh(-3)).toBe(3.3);
    expect(suitPaceKmh(24.9)).toBeGreaterThan(0);
    expect(suitPaceKmh(25)).toBe(0);
    expect(suitPaceKmh(-25)).toBe(0);
    expect(suitPaceKmh(Number.NaN)).toBe(0);
  });
});

describe('walkingField', () => {
  it('keeps times as float64 seconds, zero at the start', () => {
    const grid = flatGrid(41, 41, 10);
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 1);
    expect(field).toBeInstanceOf(Float64Array);
    expect(field.length).toBe(41 * 41);
    expect(field[20 * 41 + 20]).toBe(0);
    const perM = 3.6 / 3.3;
    expect(field[20 * 41 + 30]).toBeCloseTo(10 * grid.cellM(20) * perM, 6);
    // A knight's move is one straight step, not a step and a diagonal.
    expect(field[21 * 41 + 22]).toBeCloseTo(Math.hypot(1, 2) * grid.cellM(20.5) * perM, 3);
    expect(field[21 * 41 + 22]).toBeLessThan((1 + Math.SQRT2) * 10 * perM * 0.99);
  });

  it('is a near circle on flat ground: every direction within 5% of the mean reach', () => {
    const grid = flatGrid(301, 301, 10);
    const [lon, lat] = centre(grid);
    const hours = 0.4;
    const field = walkingField(grid, lat, lon, hours);
    const rings = contour(grid, field, hours * 3600);
    expect(rings.length).toBe(1);
    const ring = rings[0] as LonLat[];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const reach = ring.map((p) => haversineM([lon, lat], p));
    const mean = reach.reduce((a, b) => a + b, 0) / reach.length;
    expect(mean).toBeGreaterThan(3300 * hours * 0.96);
    expect(mean).toBeLessThanOrEqual(3300 * hours * 1.001);
    expect(Math.max(...reach) / mean).toBeLessThan(1.05);
    expect(Math.min(...reach) / mean).toBeGreaterThan(0.95);
    // Every compass direction is covered.
    const seen = new Set(ring.map((p) => Math.floor(((Math.atan2(p[1] - lat, p[0] - lon) + Math.PI) / (2 * Math.PI)) * 36)));
    expect(seen.size).toBeGreaterThanOrEqual(36);
  });

  it('with 8 directions alone the same check would fail (an octagon is 8% out)', () => {
    // Reach along a diagonal-and-straight path at 22.5 degrees against the true distance.
    const octagon = Math.cos(Math.PI / 8) + Math.sin(Math.PI / 8) * (Math.SQRT2 - 1);
    expect(octagon).toBeGreaterThan(1.08);
    const grid = flatGrid(201, 201, 10);
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 1);
    // 60 cells east, 25 south: about 22.6 degrees off the axis.
    const t = field[125 * 201 + 160] as number;
    const straight = Math.hypot(60, 25) * grid.cellWidthM * (3.6 / 3.3);
    expect(t / straight).toBeLessThan(1.03);
    expect(t / straight).toBeGreaterThanOrEqual(0.999);
  });

  it('stops at a wall', () => {
    // A cliff 300 m high right across the grid, 20 cells north of the start.
    const grid = syntheticGrid(121, 121, 10, (r) => (r === 40 || r === 41 ? 300 : 0));
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 2);
    expect(field[45 * 121 + 60]).toBeLessThan(Infinity);
    for (let c = 0; c < 121; c++) {
      for (let r = 0; r <= 41; r++) expect(field[r * 121 + c]).toBe(Infinity);
    }
    const rings = contour(grid, field, 2 * 3600);
    expect(rings.length).toBe(1);
    const ring = rings[0] as LonLat[];
    expect(Math.max(...ring.map((p) => p[1]))).toBeLessThan(grid.latOf(41));
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('goes round the end of a wall, arriving later than the straight walk would', () => {
    const grid = syntheticGrid(121, 121, 10, (r, c) => (r === 50 && c >= 30 ? 300 : 0));
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 3);
    const behind = field[40 * 121 + 60] as number;
    const perM = 3.6 / 3.3;
    expect(behind).toBeLessThan(Infinity);
    const round = (Math.hypot(32, 10) + Math.hypot(32, 10)) * 10 * perM;
    expect(behind).toBeGreaterThan(round * 0.97);
    expect(behind).toBeLessThan(round * 1.08);
    // A diagonal wall one cell thick is not slipped through either.
    const diag = syntheticGrid(61, 61, 10, (r, c) => (r === c ? 300 : 0));
    const f2 = walkingField(diag, diag.latOf(40), diag.lonOf(20), 3);
    expect(f2[20 * 61 + 40]).toBe(Infinity);
    expect(f2[45 * 61 + 10]).toBeLessThan(Infinity);
  });

  it('reaches further downhill than uphill, and not at all up ground too steep', () => {
    const grid = slopedGrid(201, 201, 10, 8, 'east');
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 0.25);
    const up = field[100 * 201 + 140] as number;
    const down = field[100 * 201 + 60] as number;
    expect(up).toBeGreaterThan(down * 1.3);
    expect(up).toBeCloseTo((40 * grid.cellM(100) * 3.6) / suitPaceKmh(8), 0);

    const steep = slopedGrid(61, 61, 10, 30, 'east');
    const f2 = walkingField(steep, steep.latOf(30), steep.lonOf(30), 1);
    // Straight up or down is blocked, but along the slope and at a slant is not.
    expect(f2[30 * 61 + 31]).toBeGreaterThan((f2[31 * 61 + 30] as number) * 3);
    expect(f2[10 * 61 + 30]).toBeLessThan(Infinity);
  });

  it('takes a custom pace and does not search past the limit', () => {
    const grid = flatGrid(201, 201, 10);
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 0.1, () => 6);
    expect(field[100 * 201 + 110]).toBeCloseTo((10 * grid.cellM(100) * 3.6) / 6, 6);
    // 0.1 h at 6 km/h is 600 m: the corners, 1.4 km away, are never reached.
    expect(field[0]).toBe(Infinity);
    const reached = field.filter((v) => v < Infinity);
    expect(Math.max(...reached)).toBeLessThan(0.1 * 3600 + 30);
  });

  it('returns an empty field for a start off the grid', () => {
    const grid = flatGrid(21, 21, 10);
    const field = walkingField(grid, grid.latOf(-5), grid.lonOf(3), 1);
    expect(field.every((v) => v === Infinity)).toBe(true);
    expect(contour(grid, field, 600)).toEqual([]);
  });
});

describe('contour', () => {
  it('interpolates the crossing between samples', () => {
    const grid = flatGrid(5, 9, 10);
    // Time rises by 10 s per column.
    const field = new Float64Array(5 * 9);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) field[r * 9 + c] = c * 10;
    const rings = contour(grid, field, 34);
    expect(rings.length).toBe(1);
    const ring = rings[0] as LonLat[];
    const east = Math.max(...ring.map((p) => p[0]));
    expect(east).toBeCloseTo(grid.lonOf(3.4), 9);
    // Where the reached ground runs to the edge of the grid, the ring follows the edge.
    expect(Math.min(...ring.map((p) => p[0]))).toBeCloseTo(grid.lonOf(0), 9);
    expect(Math.max(...ring.map((p) => p[1]))).toBeCloseTo(grid.latOf(0), 9);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(within(ring, [grid.lonOf(2), grid.latOf(2)])).toBe(true);
    expect(within(ring, [grid.lonOf(5), grid.latOf(2)])).toBe(false);
  });

  it('draws one ring per separate patch and a ring round a hole', () => {
    const grid = flatGrid(20, 20, 10);
    const field = new Float64Array(400).fill(100);
    for (const [r, c] of [
      [4, 4],
      [4, 5],
      [5, 4],
      [5, 5],
      [14, 14],
    ] as const) {
      field[r * 20 + c] = 0;
    }
    expect(contour(grid, field, 50).length).toBe(2);
    // Everything reached except one cell in the middle: the outer edge and the hole.
    const holed = new Float64Array(400).fill(0);
    holed[10 * 20 + 10] = Infinity;
    const rings = contour(grid, holed, 50);
    expect(rings.length).toBe(2);
    expect(rings.every((ring) => ring.length >= 4)).toBe(true);
  });

  it('nests the levels: a shorter time lies inside a longer one', () => {
    const grid = flatGrid(201, 201, 10);
    const [lon, lat] = centre(grid);
    const field = walkingField(grid, lat, lon, 0.2);
    const inner = contour(grid, field, 0.1 * 3600)[0] as LonLat[];
    const outer = contour(grid, field, 0.2 * 3600)[0] as LonLat[];
    expect(inner.every((p) => within(outer, p))).toBe(true);
    expect(within(inner, [lon, lat])).toBe(true);
  });

  it('rejects a field of the wrong size', () => {
    expect(() => contour(flatGrid(4, 4, 10), new Float64Array(3), 1)).toThrow(/does not match/);
  });
});
