/**
 * The USGS global geologic map of Mars (Tanaka et al. 2014, SIM 3292), cut to the region as
 * public/data/geology.json: which unit lies under a point, which units a path crosses, and how old a
 * unit is.
 */
import { haversineM } from './terrain';
import type { LonLat, PathPoint } from './types';

/** One map unit, e.g. HNt, the Hesperian and Noachian transition unit that floors Jezero. */
export interface GeoUnit {
  /** Unit code after Tanaka et al. 2014, e.g. 'mNh', 'HNt', 'eHv'. */
  code: string;
  name: string;
  /** The USGS map colour, e.g. '#c8a27a'. */
  colour: string;
  /** Broad family: highland, transition, volcanic, impact, basin, lowland, polar, apron. */
  kind: string;
  /** One line on what the unit is. */
  what: string;
  /** e.g. 'Middle Noachian', 'Hesperian and Noachian'. */
  period: string;
  /** Age in words, e.g. 'about 3.9 billion years'. */
  age: string;
}

export type GeoGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface GeoFeature {
  type: 'Feature';
  properties: { unit: string; [key: string]: unknown };
  geometry: GeoGeometry;
}

/** The shape of public/data/geology.json. */
export interface GeologyData {
  units: GeoUnit[];
  features: { type: 'FeatureCollection'; features: GeoFeature[] };
}

/* ---------- ages ---------- */

type Era = 'noachian' | 'hesperian' | 'amazonian';
type Part = 'early' | 'middle' | 'late';

/**
 * Epoch boundaries in billions of years (Ga), Neukum chronology as tabled by Michael (2013) and used
 * with the Tanaka et al. (2014) map. The start of the Noachian is taken as 4.1 Ga.
 */
export const EPOCHS_GA: Record<Era, Record<Part | 'all', readonly [from: number, to: number]>> = {
  noachian: { early: [4.1, 3.94], middle: [3.94, 3.83], late: [3.83, 3.71], all: [4.1, 3.71] },
  // The Hesperian has no middle epoch; a "Middle Hesperian" is read as the whole period.
  hesperian: { early: [3.71, 3.61], middle: [3.71, 3.37], late: [3.61, 3.37], all: [3.71, 3.37] },
  amazonian: { early: [3.37, 1.23], middle: [1.23, 0.328], late: [0.328, 0], all: [3.37, 0] },
};

const ERA_WORDS: Record<string, Era> = { noachian: 'noachian', hesperian: 'hesperian', amazonian: 'amazonian' };
const PART_WORDS: Record<string, Part> = { early: 'early', middle: 'middle', mid: 'middle', late: 'late' };
const ERA_LETTERS: Record<string, Era> = { N: 'noachian', H: 'hesperian', A: 'amazonian' };
const PART_LETTERS: Record<string, Part> = { e: 'early', m: 'middle', l: 'late' };

type Span = readonly [from: number, to: number];

/** The time spans named in a period such as "Late Hesperian to Early Amazonian". */
function spansFromPeriod(period: string): Span[] {
  const spans: Span[] = [];
  let parts: Part[] = [];
  for (const word of period.toLowerCase().split(/[^a-z]+/)) {
    const part = PART_WORDS[word];
    if (part) {
      parts.push(part);
      continue;
    }
    const era = ERA_WORDS[word];
    if (!era) continue;
    if (parts.length === 0) spans.push(EPOCHS_GA[era].all);
    for (const p of parts) spans.push(EPOCHS_GA[era][p]);
    parts = [];
  }
  return spans;
}

/** The time spans in a unit code: 'mNh' is Middle Noachian, 'HNt' Hesperian and Noachian, 'AHi' both. */
function spansFromCode(code: string): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < code.length; i++) {
    const ch = code[i] ?? '';
    const next = code[i + 1] ?? '';
    const part = PART_LETTERS[ch];
    const nextEra = ERA_LETTERS[next];
    if (part && nextEra) {
      spans.push(EPOCHS_GA[nextEra][part]);
      i++;
      continue;
    }
    const era = ERA_LETTERS[ch];
    if (!era) break;
    spans.push(EPOCHS_GA[era].all);
  }
  return spans;
}

/**
 * A unit's age as one number: the midpoint of its time span in billions of years. A unit that spans
 * periods (HNt, AHi) takes the middle of the whole span. Read from the unit's period, or from its
 * code if the period says nothing. NaN if neither does.
 */
export function ageGa(unit: GeoUnit): number {
  let spans = spansFromPeriod(unit.period ?? '');
  if (spans.length === 0) spans = spansFromCode(unit.code ?? '');
  if (spans.length === 0) return Number.NaN;
  let from = -Infinity;
  let to = Infinity;
  for (const [a, b] of spans) {
    if (a > from) from = a;
    if (b < to) to = b;
  }
  return (from + to) / 2;
}

/* ---------- point in unit ---------- */

interface Indexed {
  unit: GeoUnit;
  /** Each polygon: its outer ring, then its holes. */
  polygons: number[][][][];
  boxes: (readonly [w: number, s: number, e: number, n: number])[];
}

const indexes = new WeakMap<GeologyData, Indexed[]>();

function indexOf(geo: GeologyData): Indexed[] {
  const known = indexes.get(geo);
  if (known) return known;
  const byCode = new Map(geo.units.map((u) => [u.code, u]));
  const out: Indexed[] = [];
  for (const feature of geo.features?.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const code = String(feature.properties?.unit ?? '');
    const unit: GeoUnit = byCode.get(code) ?? {
      code,
      name: code,
      colour: '#888888',
      kind: '',
      what: '',
      period: '',
      age: '',
    };
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
    const kept = polygons.filter((rings) => (rings[0]?.length ?? 0) >= 3);
    if (kept.length === 0) continue;
    out.push({ unit, polygons: kept, boxes: kept.map((rings) => boxOf(rings[0] ?? [])) });
  }
  indexes.set(geo, out);
  return out;
}

function boxOf(ring: number[][]): readonly [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of ring) {
    const x = p[0] ?? 0;
    const y = p[1] ?? 0;
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function inRing(ring: number[][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    const bx = b[0] ?? 0;
    const by = b[1] ?? 0;
    if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** The unit under a point, or null where the map has none (off its edge, or in a gap). */
export function unitAt(geo: GeologyData, lon: number, lat: number): GeoUnit | null {
  for (const item of indexOf(geo)) {
    for (let k = 0; k < item.polygons.length; k++) {
      const box = item.boxes[k];
      const rings = item.polygons[k];
      if (!box || !rings) continue;
      if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
      const outer = rings[0];
      if (!outer || !inRing(outer, lon, lat)) continue;
      let inHole = false;
      for (let h = 1; h < rings.length && !inHole; h++) {
        const hole = rings[h];
        if (hole && inRing(hole, lon, lat)) inHole = true;
      }
      if (!inHole) return item.unit;
    }
  }
  return null;
}

/* ---------- units along a path ---------- */

export interface UnitStretch {
  unit: GeoUnit;
  /** Distance along the path where the stretch starts and ends, metres. */
  fromM: number;
  toM: number;
}

/** The map is simplified to about 1 km, so a look every 100 m, then a search to 10 m, is plenty. */
const LOOK_EVERY_M = 100;
const EDGE_WITHIN_M = 10;

/**
 * The units a path crosses, in order, with where each stretch starts and ends along it. Ground with
 * no mapped unit is left out, so stretches may have gaps between them.
 */
export function unitsAlong(geo: GeologyData, path: readonly (LonLat | PathPoint)[]): UnitStretch[] {
  const first = path[0];
  if (!first) return [];

  // Distance along the path at each vertex, and a way to find the point at a distance.
  const along: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    along.push((along[i - 1] ?? 0) + (a && b ? haversineM(a, b) : 0));
  }
  const total = along[along.length - 1] ?? 0;
  let seg = 1;
  const unitAtDistance = (d: number): GeoUnit | null => {
    // Called with rising and falling distances during the edge search, so move both ways.
    while (seg < path.length - 1 && (along[seg] ?? 0) < d) seg++;
    while (seg > 1 && (along[seg - 1] ?? 0) > d) seg--;
    const a = path[seg - 1] ?? first;
    const b = path[seg] ?? a;
    const d0 = along[seg - 1] ?? 0;
    const len = (along[seg] ?? d0) - d0;
    const t = len > 0 ? Math.min(1, Math.max(0, (d - d0) / len)) : 0;
    return unitAt(geo, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
  };

  const out: UnitStretch[] = [];
  let current = unitAtDistance(0);
  let startM = 0;
  let prevD = 0;
  const steps = Math.max(1, Math.ceil(total / LOOK_EVERY_M));
  for (let k = 1; k <= steps; k++) {
    const d = Math.min(total, (k * total) / steps);
    const here = unitAtDistance(d);
    if (here?.code !== current?.code) {
      // Close in on the boundary between the last two looks.
      let lo = prevD;
      let hi = d;
      while (hi - lo > EDGE_WITHIN_M) {
        const mid = (lo + hi) / 2;
        if (unitAtDistance(mid)?.code === current?.code) lo = mid;
        else hi = mid;
      }
      const edge = (lo + hi) / 2;
      if (current) out.push({ unit: current, fromM: startM, toM: edge });
      current = here;
      startM = edge;
    }
    prevD = d;
  }
  if (current && total >= startM) out.push({ unit: current, fromM: startM, toM: total });
  return out;
}
