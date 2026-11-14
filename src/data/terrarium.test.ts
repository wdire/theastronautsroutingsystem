import { describe, expect, it } from 'vitest';
import { decodeTerrarium, encodeTerrarium, gridZoomFor, tileWindow, upsampleHeights, TILE } from './terrarium';

describe('terrarium', () => {
  it('round-trips Mars heights to better than 1 cm', () => {
    const heights = new Float32Array([-8200.25, -2568.4, 0, 0.5, 21229.99, -4500.123]);
    const back = decodeTerrarium(encodeTerrarium(heights));
    heights.forEach((h, i) => expect(Math.abs((back[i] ?? NaN) - h)).toBeLessThan(0.01));
  });

  it('decodes the documented formula', () => {
    // 32768 m offset: (128, 0, 0) is sea level; one step of G is 1 m; one step of B is 1/256 m.
    expect(Array.from(decodeTerrarium(new Uint8Array([128, 0, 0, 255, 128, 1, 128, 255, 117, 248, 0, 255])))).toEqual([0, 1.5, -2568]);
  });

  it('upsamples a plane without bending it and stays inside the ancestor', () => {
    const src = new Float32Array(TILE * TILE);
    for (let y = 0; y < TILE; y += 1) for (let x = 0; x < TILE; x += 1) src[y * TILE + x] = 10 * x + 3 * y;
    // Child (dz 2) at position (1, 2) covers source pixels x 64..128, y 128..192.
    const out = upsampleHeights(src, 2, 1, 2);
    // The centre of output pixel (x, y) sits at source 64 + (x + 0.5) / 4 - 0.5.
    const at = (x: number, y: number) => out[y * TILE + x] ?? NaN;
    expect(at(0, 0)).toBeCloseTo(10 * (64 + 0.125 - 0.5) + 3 * (128 + 0.125 - 0.5), 3);
    expect(at(200, 100)).toBeCloseTo(10 * (64 + 200.5 / 4 - 0.5) + 3 * (128 + 100.5 / 4 - 0.5), 3);
    // At the ancestor's own edge the blend clamps rather than reading outside.
    const corner = upsampleHeights(src, 3, 7, 7);
    expect(corner[TILE * TILE - 1]).toBeCloseTo(10 * 255 + 3 * 255, 3);
    expect(Number.isFinite(corner[0] ?? NaN)).toBe(true);
  });

  it('finds the tile window of a box', () => {
    // The whole world at zoom 0 is one tile.
    expect(tileWindow([-180, -85, 180, 85], 0)).toMatchObject({ x0: 0, y0: 0, x1: 0, y1: 0, left: 0, cols: 256 });
    const w = tileWindow([77.3, 18.3, 77.6, 18.6], 12);
    expect(w.x1).toBeGreaterThanOrEqual(w.x0);
    expect(w.cols).toBeGreaterThan(800);
    expect(w.cols).toBeLessThan(900);
    expect(w.rows).toBeGreaterThan(800);
    // A degenerate box still gives one cell.
    expect(tileWindow([77.4, 18.4, 77.4, 18.4], 10)).toMatchObject({ cols: 1, rows: 1 });
  });

  it('picks the finest zoom that fits the cell budget', () => {
    const small: [number, number, number, number] = [77.4, 18.4, 77.45, 18.45];
    expect(gridZoomFor(small, 1_500_000, 14)).toBe(14);
    const region: [number, number, number, number] = [71.8, 13.1, 83.1, 23.8];
    const z = gridZoomFor(region, 1_500_000, 14);
    const w = tileWindow(region, z);
    expect(w.cols * w.rows).toBeLessThanOrEqual(1_500_000);
    const finer = tileWindow(region, z + 1);
    expect(finer.cols * finer.rows).toBeGreaterThan(1_500_000);
    expect(gridZoomFor(region, 10, 14, 6)).toBe(6);
  });
});
