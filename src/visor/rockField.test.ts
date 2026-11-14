import { describe, expect, it } from 'vitest';
import { ROCK_CLASSES, hash, rocksInCell, slopeWeight } from './rockField';

const cobble = ROCK_CLASSES[1]!;

describe('rock field', () => {
  it('puts the same rocks in the same cell every time', () => {
    expect(rocksInCell(cobble, 14, -3, 4)).toEqual(rocksInCell(cobble, 14, -3, 4));
    expect(rocksInCell(cobble, 14, -3, 4)).not.toEqual(rocksInCell(cobble, 15, -3, 4));
  });

  it('keeps every rock inside its cell and inside its size class', () => {
    for (const cls of ROCK_CLASSES) {
      for (const [ix, iz] of [[0, 0], [-7, 12], [300, -41]] as const) {
        for (const r of rocksInCell(cls, ix, iz, 0)) {
          expect(r.x).toBeGreaterThanOrEqual(ix * cls.cellM);
          expect(r.x).toBeLessThan((ix + 1) * cls.cellM);
          expect(r.z).toBeGreaterThanOrEqual(iz * cls.cellM);
          expect(r.z).toBeLessThan((iz + 1) * cls.cellM);
          expect(r.size).toBeGreaterThanOrEqual(cls.minM);
          expect(r.size).toBeLessThanOrEqual(cls.maxM);
        }
      }
    }
  });

  it('sheds up to three times as many, and larger, rocks on steep ground', () => {
    let flat = 0;
    let steep = 0;
    let flatSize = 0;
    let steepSize = 0;
    for (let i = 0; i < 400; i += 1) {
      const a = rocksInCell(cobble, i, 7, 2);
      const b = rocksInCell(cobble, i, 7, 28);
      flat += a.length;
      steep += b.length;
      flatSize += a.reduce((s, r) => s + r.size, 0);
      steepSize += b.reduce((s, r) => s + r.size, 0);
    }
    expect(steep / flat).toBeGreaterThan(2.6);
    expect(steep / flat).toBeLessThan(3.2);
    expect(steepSize / steep).toBeGreaterThan((flatSize / flat) * 1.3);
    expect(slopeWeight(0)).toBe(0);
    expect(slopeWeight(6)).toBe(0);
    expect(slopeWeight(20)).toBe(1);
    expect(slopeWeight(60)).toBe(1);
  });

  it('clears rocks where the caller asks', () => {
    const all = rocksInCell(cobble, 2, 2, 10);
    const none = rocksInCell(cobble, 2, 2, 10, () => true);
    expect(all.length).toBeGreaterThan(0);
    expect(none).toEqual([]);
  });

  it('does not line rocks up in rows', () => {
    // Along a strip of cells, positions inside the cell must not repeat from one cell to the next.
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const r = rocksInCell(cobble, i, 4, 0)[0];
      if (!r) continue;
      xs.add(Math.round((r.x - i * cobble.cellM) * 20));
      zs.add(Math.round((r.z - 4 * cobble.cellM) * 20));
    }
    expect(xs.size).toBeGreaterThan(100);
    expect(zs.size).toBeGreaterThan(100);
  });

  it('hashes evenly enough', () => {
    let sum = 0;
    for (let i = 0; i < 5000; i += 1) sum += hash(i, i * 7 - 3, 5);
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
  });
});
