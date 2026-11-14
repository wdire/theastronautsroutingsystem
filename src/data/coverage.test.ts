import { describe, expect, it } from 'vitest';
import { fetchCoverage, hasTile, maxZoomOf, nearestTile, tileUrl, type Coverage } from './coverage';

const cov: Coverage = {
  version: 'abc123',
  boxes: { region: [71.8, 13.1, 83.1, 23.8], core: [76.2, 17.3, 78.7, 19.6], crater: [77, 18, 78, 19], hirise: [77.3, 18.3, 77.6, 18.6] },
  products: {
    planetImg: { '0': [[0, 0, 0, 0]], '1': [[0, 0, 1, 1]], '2': [[0, 0, 3, 3]] },
    img: { '6': [[44, 28, 46, 29]], '7': [[89, 56, 93, 59]] },
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('coverage', () => {
  it('knows which tiles the package has, edges included', () => {
    expect(hasTile(cov, 'img', 6, 44, 28)).toBe(true);
    expect(hasTile(cov, 'img', 6, 46, 29)).toBe(true);
    expect(hasTile(cov, 'img', 6, 47, 29)).toBe(false);
    expect(hasTile(cov, 'img', 5, 22, 14)).toBe(false);
    expect(hasTile(cov, 'terrain', 6, 44, 28)).toBe(false);
    expect(maxZoomOf(cov, 'img')).toBe(7);
    expect(maxZoomOf(cov, 'terrain')).toBe(-1);
  });

  it('falls back to the nearest ancestor, finer product first', () => {
    expect(nearestTile(cov, ['img', 'planetImg'], 7, 90, 57)).toEqual({ product: 'img', z: 7, x: 90, y: 57 });
    // Zoom 9 inside the region: its zoom 7 ancestor is in the package.
    expect(nearestTile(cov, ['img', 'planetImg'], 9, 360, 228)).toEqual({ product: 'img', z: 7, x: 90, y: 57 });
    // Far side of the planet at zoom 5: only the planet mosaic covers it.
    expect(nearestTile(cov, ['img', 'planetImg'], 5, 3, 12)).toEqual({ product: 'planetImg', z: 2, x: 0, y: 1 });
    expect(nearestTile(cov, ['terrain'], 5, 3, 12)).toBeNull();
  });

  it('builds versioned tile URLs', () => {
    expect(tileUrl(cov, { product: 'img', z: 7, x: 90, y: 57 })).toBe('/region/img/7/90/57.webp?v=abc123');
  });

  it('tries three times before giving up, and takes the first good answer', async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('connection reset');
      return json(cov);
    };
    await expect(fetchCoverage(flaky, 1)).resolves.toEqual(cov);
    expect(calls).toBe(3);

    calls = 0;
    const dead = async () => {
      calls += 1;
      throw new TypeError('offline');
    };
    await expect(fetchCoverage(dead, 1)).rejects.toThrow('offline');
    expect(calls).toBe(3);
  });

  it('rejects an HTML fallback page and a file of the wrong shape', async () => {
    const html = async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(fetchCoverage(html, 1)).rejects.toThrow();
    await expect(fetchCoverage(async () => json({ hello: 'world' }), 1)).rejects.toThrow('unexpected shape');
    await expect(fetchCoverage(async () => json(cov, 503), 1)).rejects.toThrow('503');
  });
});
