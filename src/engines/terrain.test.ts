import { describe, expect, it } from 'vitest';
import { MARS_RADIUS_M, REGION_CENTER } from '../lib/constants';
import {
  cropAround,
  decimate,
  flatGrid,
  gradients,
  gridSpecOf,
  haversineM,
  makeGrid,
  pathElevations,
  pathLengthM,
  resamplePath,
  slopedGrid,
  syntheticGrid,
  windowAround,
} from './terrain';
import type { GridSpec } from './terrain';
import type { LonLat, PathPoint } from './types';

function spec(rows: number, cols: number, fill: (r: number, c: number) => number): GridSpec {
  // Zoom 9, starting at the tile that holds Jezero; one sample every pixel (about 395 m).
  const heights = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = fill(r, c);
  return { zoom: 9, px0: 93_700, py0: 58_700, step: 1, rows, cols, heights };
}

describe('makeGrid', () => {
  it('places samples on the Web Mercator world: row 0 north, column 0 west', () => {
    const g = makeGrid(spec(20, 30, () => 0));
    const world = 256 * 2 ** 9;
    expect(g.lonOf(0)).toBeCloseTo((93_700 / world) * 360 - 180, 10);
    expect(g.lonOf(29)).toBeGreaterThan(g.lonOf(0));
    expect(g.latOf(0)).toBeGreaterThan(g.latOf(19));
    expect(g.west).toBe(g.lonOf(0));
    expect(g.east).toBe(g.lonOf(29));
    expect(g.north).toBe(g.latOf(0));
    expect(g.south).toBe(g.latOf(19));
    // Jezero's latitude band.
    expect(g.north).toBeGreaterThan(17);
    expect(g.north).toBeLessThan(20);
  });

  it('inverts row and column exactly', () => {
    const g = makeGrid(spec(20, 30, () => 0));
    for (const r of [0, 3.25, 19]) expect(g.rowOf(g.latOf(r))).toBeCloseTo(r, 8);
    for (const c of [0, 7.5, 29]) expect(g.colOf(g.lonOf(c))).toBeCloseTo(c, 8);
  });

  it('sizes a cell by the cosine of its latitude', () => {
    const g = makeGrid(spec(20, 30, () => 0));
    const world = 256 * 2 ** 9;
    const expected = (Math.cos((g.latOf(4) * Math.PI) / 180) * 2 * Math.PI * MARS_RADIUS_M) / world;
    expect(g.cellM(4)).toBeCloseTo(expected, 6);
    expect(g.cellM(19)).toBeGreaterThan(g.cellM(0));
    expect(g.cellWidthM).toBeCloseTo(g.cellM(9.5), 6);
    // The cell size agrees with the distance between neighbouring samples.
    const east = haversineM([g.lonOf(10), g.latOf(4)], [g.lonOf(11), g.latOf(4)]);
    const south = haversineM([g.lonOf(10), g.latOf(4)], [g.lonOf(10), g.latOf(5)]);
    expect(east).toBeCloseTo(g.cellM(4), 0);
    expect(south / g.cellM(4.5)).toBeCloseTo(1, 3);
  });

  it('reads heights bilinearly and clamps outside the grid', () => {
    const g = makeGrid(spec(4, 4, (r, c) => r * 10 + c));
    expect(g.elevation(g.latOf(1), g.lonOf(2))).toBeCloseTo(12, 4);
    expect(g.elevation(g.latOf(1.5), g.lonOf(2.5))).toBeCloseTo(17.5, 4);
    expect(g.elevation(g.latOf(-3), g.lonOf(-3))).toBeCloseTo(0, 4);
    expect(g.elevation(g.latOf(9), g.lonOf(9))).toBeCloseTo(33, 4);
  });

  it('rejects a spec whose heights do not match its size', () => {
    expect(() => makeGrid({ ...spec(3, 3, () => 0), rows: 4 })).toThrow(/heights/);
  });

  it('measures slope by Horn on a plane, in any direction', () => {
    const east = slopedGrid(12, 12, 50, 10, 'east');
    const north = slopedGrid(12, 12, 50, 17, 'north');
    expect(east.slopeDeg(5, 5)).toBeCloseTo(10, 1);
    expect(north.slopeDeg(6, 4)).toBeCloseTo(17, 1);
    expect(flatGrid(5, 5, 50, 123).slopeDeg(2, 2)).toBe(0);
  });

  it('gives gradient components with their signs', () => {
    const east = gradients(slopedGrid(10, 10, 50, 10, 'east'));
    const north = gradients(slopedGrid(10, 10, 50, 10, 'north'));
    const i = 5 * 10 + 5;
    expect(east.east[i]).toBeCloseTo(Math.tan((10 * Math.PI) / 180), 3);
    expect(east.north[i]).toBeCloseTo(0, 5);
    expect(north.north[i]).toBeCloseTo(Math.tan((10 * Math.PI) / 180), 3);
    expect(north.east[i]).toBeCloseTo(0, 5);
  });

  it('measures ruggedness as the mean height difference to the 8 neighbours', () => {
    const g = syntheticGrid(5, 5, 20, (r, c) => (r === 2 && c === 2 ? 8 : 0));
    expect(g.ruggedness(2, 2)).toBeCloseTo(8, 5);
    expect(g.ruggedness(1, 1)).toBeCloseTo(1, 5);
    expect(g.ruggedness(0, 0)).toBe(0);
  });

  it('crops a window that keeps its place on the planet', () => {
    const g = makeGrid(spec(20, 30, (r, c) => r * 100 + c));
    const w = g.crop(5, 10, 9, 16);
    expect(w.rows).toBe(4);
    expect(w.cols).toBe(6);
    expect(w.heights[0]).toBe(510);
    expect(w.heights[w.heights.length - 1]).toBe(815);
    expect(w.latOf(0)).toBeCloseTo(g.latOf(5), 10);
    expect(w.lonOf(0)).toBeCloseTo(g.lonOf(10), 10);
    expect(w.cellM(1)).toBeCloseTo(g.cellM(6), 8);
    // A copy: changing it leaves the source alone.
    w.heights[0] = -1;
    expect(g.heights[5 * 30 + 10]).toBe(510);
  });
});

describe('gridSpecOf', () => {
  it('returns the spec a grid was made from, and one that rebuilds the same grid', () => {
    const s = spec(6, 7, (r, c) => r + c);
    const g = makeGrid(s);
    expect(gridSpecOf(g)).toBe(s);
    const again = makeGrid(structuredClone(gridSpecOf(g.crop(1, 2, 5, 6))));
    expect(again.rows).toBe(4);
    expect(again.latOf(0)).toBeCloseTo(g.latOf(1), 10);
    expect(again.lonOf(3)).toBeCloseTo(g.lonOf(5), 10);
    expect(Array.from(again.heights.slice(0, 4))).toEqual([3, 4, 5, 6]);
  });

  it('works out a spec for a grid that came from elsewhere', () => {
    const g = makeGrid(spec(6, 7, (r, c) => r + c));
    const foreign = { ...g };
    const rebuilt = makeGrid(gridSpecOf(foreign));
    expect(rebuilt.lonOf(6)).toBeCloseTo(g.lonOf(6), 9);
    expect(rebuilt.latOf(5)).toBeCloseTo(g.latOf(5), 9);
    expect(rebuilt.cellM(2)).toBeCloseTo(g.cellM(2), 6);
  });
});

describe('synthetic grids', () => {
  it('makes square cells of the size asked, around the region centre', () => {
    const g = flatGrid(101, 201, 25, 7);
    expect(g.cellWidthM).toBeCloseTo(25, 6);
    expect(g.cellM(0) / 25).toBeCloseTo(1, 3);
    expect(g.lonOf(100)).toBeCloseTo(REGION_CENTER[0], 9);
    expect(g.latOf(50)).toBeCloseTo(REGION_CENTER[1], 9);
    expect(g.heights.every((v) => v === 7)).toBe(true);
  });
});

describe('crop windows', () => {
  it('finds the window around two points with a margin, clamped to the grid', () => {
    const g = flatGrid(200, 200, 10);
    const a: LonLat = [g.lonOf(50), g.latOf(60)];
    const b: LonLat = [g.lonOf(120), g.latOf(90)];
    const w = windowAround(g, [a, b], 200);
    expect(w.r0).toBeLessThanOrEqual(40);
    expect(w.r0).toBeGreaterThanOrEqual(37);
    expect(w.c1).toBeGreaterThanOrEqual(141);
    expect(w.c1).toBeLessThanOrEqual(144);
    const all = windowAround(g, [a, b], 1e6);
    expect(all).toEqual({ r0: 0, c0: 0, r1: 200, c1: 200 });
    const cropped = cropAround(g, [a, b], 200);
    expect(cropped.rows).toBe(w.r1 - w.r0);
    expect(Math.round(cropped.rowOf(a[1]))).toBe(60 - w.r0);
  });

  it('decimates by block means and keeps positions', () => {
    const g = syntheticGrid(8, 8, 10, (r, c) => r * 8 + c);
    const d = decimate(g, 2);
    expect(d.rows).toBe(4);
    expect(d.cellWidthM).toBeCloseTo(20, 3);
    expect(d.heights[0]).toBeCloseTo((0 + 1 + 8 + 9) / 4, 5);
    expect(d.lonOf(0)).toBeCloseTo((g.lonOf(0) + g.lonOf(1)) / 2, 9);
    expect(decimate(g, 1)).toBe(g);
  });
});

describe('paths', () => {
  it('measures great-circle distance with the radius of Mars', () => {
    expect(haversineM([77, 18], [77, 19])).toBeCloseTo((Math.PI / 180) * MARS_RADIUS_M, 3);
    expect(haversineM([0, 0], [90, 0])).toBeCloseTo((Math.PI / 2) * MARS_RADIUS_M, 3);
    expect(haversineM([77.4, 18.4], [77.4, 18.4])).toBe(0);
  });

  it('adds up the length of a path', () => {
    const path: LonLat[] = [
      [77, 18],
      [77, 18.1],
      [77.1, 18.1],
    ];
    expect(pathLengthM(path)).toBeCloseTo(haversineM([77, 18], [77, 18.1]) + haversineM([77, 18.1], [77.1, 18.1]), 6);
    expect(pathLengthM([])).toBe(0);
  });

  it('gives each point its height', () => {
    const g = slopedGrid(20, 20, 10, 5, 'east');
    const out = pathElevations(g, [
      [g.lonOf(0), g.latOf(3)],
      [g.lonOf(10), g.latOf(3)],
    ]);
    expect(out[0]?.[2]).toBeCloseTo(0, 3);
    expect(out[1]?.[2]).toBeCloseTo(100 * Math.tan((5 * Math.PI) / 180), 2);
    expect(out[1]?.[0]).toBe(g.lonOf(10));
  });

  it('resamples at even spacing, keeping both ends and interpolating heights', () => {
    const path: PathPoint[] = [
      [77, 18, 0],
      [77, 18.01, 100],
    ];
    const len = pathLengthM(path);
    const out = resamplePath(path, 100);
    expect(out[0]).toEqual(path[0]);
    expect(out[out.length - 1]).toEqual(path[1]);
    expect(out.length).toBe(Math.floor(len / 100) + 2);
    const a = out[1];
    const b = out[2];
    expect(a && b ? haversineM(a, b) : 0).toBeCloseTo(100, 3);
    expect(out[3]?.[2]).toBeCloseTo((300 / len) * 100, 3);
    expect(pathLengthM(out)).toBeCloseTo(len, 4);
  });

  it('resamples across corners and handles short and empty paths', () => {
    const path: LonLat[] = [
      [77, 18],
      [77.002, 18],
      [77.002, 18.002],
    ];
    const out = resamplePath(path, 50);
    for (let i = 2; i < out.length - 1; i++) {
      const p = out[i - 1];
      const q = out[i];
      // Across a corner the chord is a little shorter than the spacing along the path.
      expect(p && q ? haversineM(p, q) : 0).toBeLessThanOrEqual(50.001);
    }
    expect(out[0]?.length).toBe(2);
    expect(resamplePath([], 10)).toEqual([]);
    expect(resamplePath([[77, 18]] as LonLat[], 10)).toEqual([[77, 18]]);
    expect(resamplePath(path, 1e9)).toEqual([path[0], path[2]]);
  });
});
