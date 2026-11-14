import type { Traverse } from './datasets';

/**
 * Perseverance's drive from JPL's MMGIS layers (the ones behind NASA's "Where is Perseverance?" map),
 * shaped as public/data/traverses/m20.json. The same steps as tools/build_traverse.py, so the live
 * answer and the bundled copy agree: drives listed once per sol are kept once, the line is thinned to a
 * point every 2 m, and the waypoints are the end-of-drive localisations.
 */
export const M20_TRAVERSE_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json';
export const M20_WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';

const R = 3_396_190;
const MIN_STEP_M = 2;

interface Feature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

function distM(a: readonly number[], b: readonly number[]): number {
  const lat = (((a[1] ?? 0) + (b[1] ?? 0)) / 2) * (Math.PI / 180);
  const dx = ((b[0] ?? 0) - (a[0] ?? 0)) * (Math.PI / 180) * Math.cos(lat);
  const dy = ((b[1] ?? 0) - (a[1] ?? 0)) * (Math.PI / 180);
  return R * Math.hypot(dx, dy);
}

function features(doc: unknown): Feature[] {
  const list = (doc as { features?: unknown } | null)?.features;
  return Array.isArray(list) ? (list as Feature[]) : [];
}

export function parseM20(traverseDoc: unknown, waypointsDoc: unknown): Traverse | null {
  const drives = features(traverseDoc)
    .filter((f) => f.geometry?.coordinates)
    .sort((a, b) => num(a.properties?.sol) - num(b.properties?.sol) || num(a.properties?.SCLK_START) - num(b.properties?.SCLK_START));
  // A drive that ran over several sols is listed once per sol, each time from the same start and a
  // little longer: keep the longest of each run, or the path doubles back.
  const kept: Feature[] = [];
  for (const f of drives) {
    const last = kept[kept.length - 1];
    if (last && last.properties?.fromRMC !== undefined && last.properties.fromRMC === f.properties?.fromRMC) {
      if (num(f.properties?.length) >= num(last.properties?.length)) kept[kept.length - 1] = f;
      continue;
    }
    kept.push(f);
  }
  const points: [number, number, number][] = [];
  for (const f of kept) {
    const g = f.geometry;
    const lines = (g?.type === 'MultiLineString' ? g.coordinates : [g?.coordinates]) as unknown[];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      for (const c of line as unknown[]) {
        if (!Array.isArray(c) || c.length < 2) continue;
        points.push([round(num(c[0]), 6), round(num(c[1]), 6), round(num(c[2]), 1)]);
      }
    }
  }
  if (points.length === 0) return null;
  const path = [points[0]!];
  for (const p of points.slice(1)) if (distM(path[path.length - 1]!, p) >= MIN_STEP_M) path.push(p);
  const end = points[points.length - 1]!;
  const tail = path[path.length - 1]!;
  if (tail[0] !== end[0] || tail[1] !== end[1] || tail[2] !== end[2]) path.push(end);

  const waypoints = features(waypointsDoc)
    .map((f) => f.properties ?? {})
    .filter((p) => p.final === 'y')
    .map((p) => ({
      sol: Math.trunc(num(p.sol)),
      lon: round(num(p.lon), 6),
      lat: round(num(p.lat), 6),
      elev: round(num(p.elev_geoid), 1),
      distKm: round(num(p.dist_total_m) / 1000, 3),
    }))
    .filter((w) => w.lon !== 0 || w.lat !== 0)
    // Stable: keeps the file's order within a sol.
    .sort((a, b) => a.sol - b.sol);
  if (waypoints.length === 0) return null;
  return { rover: 'm20', name: 'Perseverance', path: path as Traverse['path'], waypoints };
}
