import type { Box } from '@/lib/constants';

/** What the tile package under /region contains, from /region/coverage.json. */
export type Product = 'img' | 'terrain' | 'planetImg' | 'planetTerrain' | 'crism';

/** Tile rectangles present at one zoom, each [x0, y0, x1, y1] with both ends included. */
export type Rects = readonly (readonly [number, number, number, number])[];

export interface Coverage {
  version: string;
  boxes: { region: Box; core: Box; crater: Box; hirise: Box };
  products: Partial<Record<Product, Record<string, Rects>>>;
}

export interface TileRef {
  product: Product;
  z: number;
  x: number;
  y: number;
}

export function hasTile(cov: Coverage, product: Product, z: number, x: number, y: number): boolean {
  const rects = cov.products[product]?.[String(z)];
  if (!rects) return false;
  for (const r of rects) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
  return false;
}

/** The deepest zoom a product has anywhere. */
export function maxZoomOf(cov: Coverage, product: Product): number {
  let max = -1;
  for (const z of Object.keys(cov.products[product] ?? {})) max = Math.max(max, Number(z));
  return max;
}

/**
 * The tile itself if the package has it, otherwise its nearest ancestor, looking through the
 * products in the order given at each zoom (finer products first).
 */
export function nearestTile(cov: Coverage, products: readonly Product[], z: number, x: number, y: number): TileRef | null {
  for (let dz = 0; dz <= z; dz += 1) {
    const az = z - dz;
    const ax = x >> dz;
    const ay = y >> dz;
    for (const product of products) if (hasTile(cov, product, az, ax, ay)) return { product, z: az, x: ax, y: ay };
  }
  return null;
}

export function tileUrl(cov: Coverage, t: TileRef): string {
  return `/region/${t.product}/${t.z}/${t.x}/${t.y}.webp?v=${cov.version}`;
}

function isCoverage(v: unknown): v is Coverage {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Partial<Coverage>;
  return typeof c.version === 'string' && typeof c.products === 'object' && c.products !== null && typeof c.boxes === 'object';
}

export type Fetcher = (url: string) => Promise<Response>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Three quick tries. Throws if none gives a valid file. */
export async function fetchCoverage(fetcher: Fetcher = (u) => fetch(u, { cache: 'no-cache' }), pauseMs = 400): Promise<Coverage> {
  let lastError: unknown = new Error('coverage.json did not load');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetcher('/region/coverage.json');
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const body: unknown = await res.json();
        if (isCoverage(body)) return body;
        lastError = new Error('coverage.json has an unexpected shape');
      } else {
        lastError = new Error(`coverage.json answered ${res.status}`);
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < 2) await wait(pauseMs * (attempt + 1));
  }
  throw lastError;
}

let current: Coverage | null = null;
let pending: Promise<Coverage | null> | null = null;
const listeners = new Set<(cov: Coverage) => void>();

export function getCoverage(): Coverage | null {
  return current;
}

export function onCoverage(cb: (cov: Coverage) => void): () => void {
  listeners.add(cb);
  if (current) cb(current);
  return () => listeners.delete(cb);
}

/**
 * Loads the coverage once. If the three tries fail it asks again every 5 s, because without it
 * the globe has nothing to draw: on a bad connection the first failure must not be the last word.
 */
export function loadCoverage(): Promise<Coverage | null> {
  if (current) return Promise.resolve(current);
  pending ??= fetchCoverage()
    .then((cov) => {
      current = cov;
      for (const cb of listeners) cb(cov);
      return cov;
    })
    .catch(() => {
      // Keep answering "not yet" until the next round, so every tile request does not start its own.
      setTimeout(() => {
        pending = null;
        void loadCoverage();
      }, 5000);
      return null;
    });
  return pending;
}
