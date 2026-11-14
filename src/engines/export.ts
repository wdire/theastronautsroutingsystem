/**
 * Taking a plan out of the app: GPX for track viewers, GeoJSON for GIS tools, cuff legs (a short list of
 * headings to follow, the way a field crew reads a wrist card) and the cuff card itself as a printable page.
 *
 * Everything here works from the path alone. The trip budget, when there is one, adds times, consumables
 * and the safety marks; without it the files still carry the route, its ends and its stops.
 * Every name and every string that came from the user or from data is escaped before it goes into XML or HTML.
 */
import { fmtClock, fmtDistance, fmtDuration, fmtPercent, fmtUtc } from '../lib/format';
import { angleDiff, bearingDeg } from '../lib/geo';
import { marsTime } from './marsTime';
import { haversineM } from './terrain';
import { VEHICLES } from './vehicles';
import type { MissionPlan, PathPoint, Task, TripResult, TripWarning } from './types';

export interface ExportInput {
  name: string;
  plan: MissionPlan;
  path: PathPoint[];
  /** Path index of the start, each stop and the end, as the router gives them. May be empty. */
  stopIndices: number[];
  /** The budget. Null, or without samples, when the trip computer did not run. */
  trip: TripResult | null;
  departUtcMs: number | null;
}

/**
 * GPX and GeoJSON readers assume Earth (WGS 84). Stating the frame in the file is the only way to keep a
 * Mars track from being read as a walk across the Indian Ocean.
 */
export const MARS_FRAME =
  'Mars. Coordinates are IAU 2000 areocentric latitude and east longitude in degrees; elevation is metres above the MOLA areoid. Not WGS 84: do not read these positions as places on Earth.';

const CREATOR = 'Areo (NASA Space Apps 2026)';

/* ---------- escaping ---------- */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Safe in XML and HTML text and in quoted attributes. */
export function escapeMarkup(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/* ---------- shared reading of the input ---------- */

export type MarkKind = 'start' | 'stop' | 'end';

/** A named place along the path: the start, a stop or the end. */
export interface ExportMark {
  kind: MarkKind;
  name: string;
  index: number;
  lon: number;
  lat: number;
  elev: number;
  tasks: Task[];
}

/** A safety mark from the trip budget. */
export interface SafetyMark {
  kind: 'pointOfNoReturn' | 'walkbackLimit' | 'o2Out';
  name: string;
  description: string;
  index: number;
}

function nearestIndex(path: readonly PathPoint[], lon: number, lat: number): number {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!p) continue;
    const d = haversineM(p, [lon, lat]);
    if (d < best) {
      best = d;
      at = i;
    }
  }
  return at;
}

function clampIndex(path: readonly PathPoint[], i: number): number {
  return Math.max(0, Math.min(path.length - 1, Math.round(i)));
}

/**
 * The start, each stop and the end with their path indices. The router's stopIndices are used when they
 * line up with the plan; otherwise each stop falls back to the nearest path point, so a plan with a path
 * and nothing else still exports with its stops in place.
 */
export function exportMarks(input: ExportInput): ExportMark[] {
  const { path, plan, stopIndices } = input;
  const last = path.length - 1;
  if (last < 0) return [];
  const at = (index: number) => {
    const p = path[index] ?? path[0];
    return { lon: p?.[0] ?? 0, lat: p?.[1] ?? 0, elev: p?.[2] ?? 0 };
  };
  const startName = plan.start?.name?.trim() || 'Start';
  const marks: ExportMark[] = [{ kind: 'start', name: startName, index: 0, tasks: [], ...at(0) }];
  const aligned = stopIndices.length >= plan.stops.length + 1;
  plan.stops.forEach((s, i) => {
    const given = aligned ? stopIndices[i + 1] : undefined;
    const index = given !== undefined ? clampIndex(path, given) : nearestIndex(path, s.lon, s.lat);
    marks.push({ kind: 'stop', name: s.name?.trim() || `Stop ${i + 1}`, index, tasks: s.tasks, ...at(index) });
  });
  // On a one-way trip the last stop is the end; a separate end mark would sit on top of it.
  const lastStop = marks[marks.length - 1];
  if (last > 0 && !(lastStop && lastStop.kind === 'stop' && lastStop.index === last)) {
    const name = plan.roundTrip ? `Back at ${startName}` : 'End';
    marks.push({ kind: 'end', name, index: last, tasks: [], ...at(last) });
  }
  return marks;
}

/** Planned UTC time at each path point, or null when the budget has no per-point samples. */
export function pointTimes(input: ExportInput): number[] | null {
  const samples = input.trip?.samples;
  if (!samples || samples.length !== input.path.length || samples.length === 0) return null;
  return samples.map((s) => s.utcMs);
}

/** The point of no return, the walk-home limit and where the oxygen runs out, where the budget has them. */
export function safetyMarks(input: ExportInput): SafetyMark[] {
  const trip = input.trip;
  const n = input.path.length;
  if (!trip || n === 0) return [];
  const out: SafetyMark[] = [];
  const add = (kind: SafetyMark['kind'], index: number | null, name: string, description: string) => {
    if (index !== null && index >= 0 && index < n) out.push({ kind, name, description, index });
  };
  add('pointOfNoReturn', trip.pointOfNoReturnIndex, 'Point of no return', 'Past here there is not enough left to come back to the start.');
  add('walkbackLimit', trip.walkbackIndex, 'Walk-home limit', 'The furthest point from which the crew could still walk home if the vehicle failed.');
  add('o2Out', trip.o2OutIndex, 'Oxygen runs out', 'At this point the crew has no oxygen left on this plan.');
  return out;
}

/** Distance along the path at each point, metres. */
function distancesAlong(path: readonly PathPoint[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) sum += haversineM(a, b);
    out.push(sum);
  }
  return out;
}

function ltstAt(utcMs: number | null, lon: number): number | null {
  return utcMs === null ? null : marsTime(utcMs, lon).ltstH;
}

function num(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '0';
}

function iso(utcMs: number): string {
  return new Date(utcMs).toISOString();
}

/* ---------- GPX ---------- */

function taskLine(tasks: readonly Task[]): string {
  return tasks.map((t) => `${t.label?.trim() || t.kind} (${t.minutes} min)`).join(', ');
}

/** GPX 1.1: the marks as waypoints, then one track with elevation and, when the budget has them, planned times. */
export function toGpx(input: ExportInput): string {
  const times = pointTimes(input);
  const marks = exportMarks(input);
  const vehicle = VEHICLES[input.plan.vehicle]?.name ?? input.plan.vehicle;
  const name = escapeMarkup(input.name);
  const depart = times?.[0] ?? input.departUtcMs;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeMarkup(CREATOR)}" xmlns="http://www.topografix.com/GPX/1/1">`,
    '  <metadata>',
    `    <name>${name}</name>`,
    `    <desc>${escapeMarkup(`${MARS_FRAME} Vehicle: ${vehicle}.`)}</desc>`,
    ...(depart !== null && depart !== undefined ? [`    <time>${iso(depart)}</time>`] : []),
    '  </metadata>',
  ];
  for (const m of marks) {
    const t = times?.[m.index];
    const desc = m.tasks.length ? `Tasks: ${taskLine(m.tasks)}.` : '';
    lines.push(
      `  <wpt lat="${num(m.lat, 6)}" lon="${num(m.lon, 6)}">`,
      `    <ele>${num(m.elev, 1)}</ele>`,
      ...(t !== undefined ? [`    <time>${iso(t)}</time>`] : []),
      `    <name>${escapeMarkup(m.name)}</name>`,
      ...(desc ? [`    <desc>${escapeMarkup(desc)}</desc>`] : []),
      `    <type>${m.kind}</type>`,
      '  </wpt>',
    );
  }
  lines.push('  <trk>', `    <name>${name}</name>`, `    <desc>${escapeMarkup(MARS_FRAME)}</desc>`, '    <trkseg>');
  input.path.forEach((p, i) => {
    const t = times?.[i];
    const time = t !== undefined ? `<time>${iso(t)}</time>` : '';
    lines.push(`      <trkpt lat="${num(p[1], 6)}" lon="${num(p[0], 6)}"><ele>${num(p[2], 1)}</ele>${time}</trkpt>`);
  });
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}

/* ---------- GeoJSON ---------- */

type Position = [number, number, number];

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: Position[] } | { type: 'Point'; coordinates: Position };
  properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  /** Not part of RFC 7946, which only knows Earth; kept as a foreign member so the frame travels with the data. */
  frame: string;
  features: GeoJsonFeature[];
}

function position(p: PathPoint): Position {
  return [p[0], p[1], p[2]];
}

/** A FeatureCollection: the route with its budget, the ends and stops as points, and the safety marks. */
export function toGeoJson(input: ExportInput): GeoJsonFeatureCollection {
  const { path, plan, trip } = input;
  const times = pointTimes(input);
  const along = distancesAlong(path);
  const timeProps = (index: number) => {
    const t = times?.[index];
    const p = path[index];
    if (t === undefined || !p) return {};
    return { arriveUtc: iso(t), arriveLtst: fmtClock(marsTime(t, p[0]).ltstH) };
  };
  const route: GeoJsonFeature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: path.map(position) },
    properties: {
      kind: 'route',
      name: input.name,
      vehicle: plan.vehicle,
      style: plan.style,
      roundTrip: plan.roundTrip,
      lengthM: Math.round(along[along.length - 1] ?? 0),
      ...(input.departUtcMs !== null ? { departUtc: iso(input.departUtcMs) } : {}),
      ...(trip
        ? { feasible: trip.feasible, limitHit: trip.limitHit, ...trip.totals, arriveUtc: iso(trip.totals.arriveUtcMs), warnings: trip.warnings.map((w) => w.text) }
        : {}),
    },
  };
  const features: GeoJsonFeature[] = [route];
  for (const m of exportMarks(input)) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lon, m.lat, m.elev] },
      properties: {
        kind: m.kind,
        name: m.name,
        index: m.index,
        distM: Math.round(along[m.index] ?? 0),
        tasks: m.tasks.map((t) => ({ kind: t.kind, ...(t.label ? { label: t.label } : {}), minutes: t.minutes })),
        ...timeProps(m.index),
      },
    });
  }
  for (const s of safetyMarks(input)) {
    const p = path[s.index];
    if (!p) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: position(p) },
      properties: { kind: s.kind, name: s.name, description: s.description, index: s.index, distM: Math.round(along[s.index] ?? 0), ...timeProps(s.index) },
    });
  }
  return { type: 'FeatureCollection', frame: MARS_FRAME, features };
}

/* ---------- cuff legs ---------- */

export interface CuffLeg {
  /** 1-based, as printed. */
  n: number;
  fromIndex: number;
  toIndex: number;
  /** Straight-line bearing from the leg's start to its end, degrees clockwise from north. */
  headingDeg: number;
  distM: number;
  /** Total height gained and lost along the leg, metres (both positive). */
  climbM: number;
  descentM: number;
  /** Arrival at the leg's end; null when the plan has no times. */
  arriveUtcMs: number | null;
  arriveLtstH: number | null;
}

export interface CuffLegOptions {
  /** Planned UTC time at each path point, as pointTimes() gives. */
  utcMs?: readonly number[] | null;
  /** Path indices where the crew stops; a leg always ends at a stop. */
  stopIndices?: readonly number[];
  /** A turn this sharp starts a new leg, degrees. */
  turnDeg?: number;
  /** No leg longer than this, metres. */
  maxLegM?: number;
}

/**
 * Routed paths step from grid cell to grid cell, so the bearing between neighbouring points swings by 45
 * degrees all the time. The course is read over this much path instead, which is what a crew would steer by.
 */
const LOOK_AHEAD_M = 200;

/**
 * Legs for a cuff card: a new leg at a turn of 30 degrees or more from the leg's opening course, at every
 * 2 km, and at every stop.
 */
export function cuffLegs(path: readonly PathPoint[], opts: CuffLegOptions = {}): CuffLeg[] {
  const turnDeg = opts.turnDeg ?? 30;
  const maxLegM = opts.maxLegM ?? 2000;
  const times = opts.utcMs && opts.utcMs.length === path.length ? opts.utcMs : null;
  const stops = new Set(opts.stopIndices ?? []);
  if (path.length < 2) return [];
  const along = distancesAlong(path);

  /** Index of the first point at least `d` metres along the path (or the last point). */
  const indexAt = (d: number): number => {
    let lo = 0;
    let hi = path.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((along[mid] ?? 0) < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const bearing = (i: number, j: number): number | null => {
    const a = path[i];
    const b = path[j];
    if (!a || !b || i === j || haversineM(a, b) < 1) return null;
    return bearingDeg(a[0], a[1], b[0], b[1]);
  };
  /** The course over the next LOOK_AHEAD_M from point i. */
  const courseAt = (i: number): number | null => bearing(i, indexAt((along[i] ?? 0) + LOOK_AHEAD_M));
  /** How sharply the path bends at point j, read over LOOK_AHEAD_M either side. */
  const bendAt = (j: number): number => {
    const d = along[j] ?? 0;
    const into = bearing(indexAt(d - LOOK_AHEAD_M), j);
    const out = bearing(j, indexAt(d + LOOK_AHEAD_M));
    return into === null || out === null ? 0 : Math.abs(angleDiff(into, out));
  };

  const legs: CuffLeg[] = [];
  const close = (from: number, to: number) => {
    const a = path[from];
    const b = path[to];
    if (!a || !b || to <= from) return;
    let climb = 0;
    let descent = 0;
    for (let i = from + 1; i <= to; i++) {
      const dz = (path[i]?.[2] ?? 0) - (path[i - 1]?.[2] ?? 0);
      if (dz > 0) climb += dz;
      else descent -= dz;
    }
    const t = times?.[to] ?? null;
    legs.push({
      n: legs.length + 1,
      fromIndex: from,
      toIndex: to,
      headingDeg: haversineM(a, b) < 1 ? 0 : bearingDeg(a[0], a[1], b[0], b[1]),
      distM: (along[to] ?? 0) - (along[from] ?? 0),
      climbM: climb,
      descentM: descent,
      arriveUtcMs: t,
      arriveLtstH: ltstAt(t, b[0]),
    });
  };

  let from = 0;
  let course = courseAt(0);
  for (let i = 1; i < path.length; i++) {
    const done = (along[i] ?? 0) - (along[from] ?? 0);
    const isEnd = i === path.length - 1;
    // A leg with no course yet (repeated points at its start) is only cut by a stop, the end or its length.
    let cut = isEnd || stops.has(i) || done >= maxLegM;
    // A turn is only judged once the leg has run its look-ahead, so one bend does not cut two legs.
    if (!cut && course !== null && done >= LOOK_AHEAD_M) {
      const here = courseAt(i);
      if (here !== null && Math.abs(angleDiff(course, here)) >= turnDeg) {
        // The look-ahead sees a turn before the crew reaches it; put the cut on the corner itself.
        const until = indexAt((along[i] ?? 0) + LOOK_AHEAD_M);
        let corner = i;
        let sharpest = bendAt(i);
        for (let j = i + 1; j < until && !stops.has(j); j++) {
          const bend = bendAt(j);
          if (bend > sharpest) {
            sharpest = bend;
            corner = j;
          }
        }
        i = corner;
        cut = true;
      }
    }
    if (cut) {
      close(from, i);
      from = i;
      course = i === path.length - 1 ? null : courseAt(i);
    }
  }
  return legs;
}

/* ---------- cuff card ---------- */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N';
}

function heading(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, '0')}° ${compass(deg)}`;
}

function climbText(m: number): string {
  return `+${Math.round(m)} m`;
}

const SEVERITY_LABEL: Record<TripWarning['severity'], string> = { note: 'Note', advisory: 'Advisory', caution: 'Caution', warning: 'Warning' };

const CARD_CSS = `
@page { size: A5 portrait; margin: 9mm; }
* { box-sizing: border-box; }
html { background: #fff; }
body { margin: 0; font: 9.5pt/1.35 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; }
h1 { font-size: 14pt; margin: 0 0 1mm; }
h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; margin: 4mm 0 1.5mm; border-bottom: .3mm solid #111; padding-bottom: .5mm; }
.sub { color: #444; margin: 0 0 2mm; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: .6mm 1.2mm; border-bottom: .2mm solid #ccc; vertical-align: top; }
th { font-weight: 600; }
td.r, th.r { text-align: right; }
.grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 4mm; }
.grid div { display: flex; justify-content: space-between; border-bottom: .2mm solid #ccc; padding: .6mm 0; }
.grid span:last-child { font-weight: 600; font-variant-numeric: tabular-nums; }
ul { margin: 0; padding-left: 4mm; }
li { margin: .4mm 0; }
.warning, .caution { font-weight: 600; }
.frame { margin-top: 4mm; font-size: 7.5pt; color: #444; }
tr { break-inside: avoid; }
`;

/** A self-contained A5 cuff card: budget, marks, warnings and legs. No scripts and nothing fetched. */
export function missionCardHtml(input: ExportInput): string {
  const { path, plan, trip } = input;
  const e = escapeMarkup;
  const times = pointTimes(input);
  const along = distancesAlong(path);
  const marks = exportMarks(input);
  const legs = cuffLegs(path, { utcMs: times, stopIndices: marks.map((m) => m.index) });
  const vehicle = VEHICLES[plan.vehicle]?.name ?? plan.vehicle;
  const depart = times?.[0] ?? input.departUtcMs;
  const start = path[0];
  const lengthM = along[along.length - 1] ?? 0;
  const when = (index: number): string => {
    const t = times?.[index];
    const p = path[index];
    return t !== undefined && p ? `${fmtClock(marsTime(t, p[0]).ltstH)} LTST` : '';
  };

  const sub: string[] = [vehicle, plan.roundTrip ? 'round trip' : 'one way'];
  if (depart !== null && depart !== undefined) {
    sub.push(`leave ${fmtUtc(depart, true)}${start ? ` (${fmtClock(marsTime(depart, start[0]).ltstH)} LTST)` : ''}`);
  }

  const budget: [string, string][] = [['Distance', fmtDistance(trip?.totals.distM ?? lengthM)]];
  if (trip) {
    const t = trip.totals;
    budget.push(
      ['Time', fmtDuration(t.durationS)],
      ['Moving', fmtDuration(t.movingS)],
      ['Climb', `${Math.round(t.climbM)} m`],
      ['Descent', `${Math.round(t.descentM)} m`],
      ['Steepest', `${Math.round(t.maxGradeDeg)}°`],
      ['Arrive', `${fmtUtc(t.arriveUtcMs)}${path.length ? ` (${fmtClock(marsTime(t.arriveUtcMs, path[path.length - 1]?.[0] ?? 0).ltstH)} LTST)` : ''}`],
    );
    if (t.o2Kg > 0) budget.push(['Oxygen used', `${t.o2Kg.toFixed(2)} kg`]);
    if (t.minO2Frac !== null) budget.push(['Lowest oxygen', fmtPercent(t.minO2Frac)]);
    if (t.energyKWh > 0) budget.push(['Energy used', `${t.energyKWh.toFixed(1)} kWh`]);
    if (t.minBatteryFrac !== null) budget.push(['Lowest battery', fmtPercent(t.minBatteryFrac)]);
    if (t.waterL > 0) budget.push(['Water', `${t.waterL.toFixed(1)} L`]);
    budget.push(['Dose', `${t.doseMSv.toFixed(2)} mSv`], ['Coldest', `${Math.round(t.minTempC)} °C`]);
  } else {
    let climb = 0;
    for (const l of legs) climb += l.climbM;
    budget.push(['Climb', `${Math.round(climb)} m`], ['Budget', 'not computed']);
  }

  const markRows = [
    ...marks.map((m) => ({ name: m.name, index: m.index, note: m.tasks.length ? taskLine(m.tasks) : '' })),
    ...safetyMarks(input).map((s) => ({ name: s.name, index: s.index, note: s.description })),
  ].sort((a, b) => a.index - b.index);

  const html: string[] = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${e(input.name)}: cuff card</title>`,
    `<style>${CARD_CSS}</style>`,
    '</head>',
    '<body>',
    `<h1>${e(input.name)}</h1>`,
    `<p class="sub">${e(sub.join(', '))}</p>`,
    trip && !trip.feasible ? '<p class="warning">This plan does not work as it stands: see the warnings.</p>' : '',
    '<h2>Budget</h2>',
    `<div class="grid">${budget.map(([k, v]) => `<div><span>${e(k)}</span><span>${e(v)}</span></div>`).join('')}</div>`,
    '<h2>Marks</h2>',
    '<table><thead><tr><th>Where</th><th class="r">At</th><th class="r">Time</th><th>Note</th></tr></thead><tbody>',
    ...markRows.map(
      (m) => `<tr><td>${e(m.name)}</td><td class="r">${e(fmtDistance(along[m.index] ?? 0))}</td><td class="r">${e(when(m.index))}</td><td>${e(m.note)}</td></tr>`,
    ),
    '</tbody></table>',
  ];
  if (trip && trip.warnings.length) {
    html.push(
      '<h2>Warnings</h2>',
      '<ul>',
      ...trip.warnings.map((w) => `<li class="${w.severity}">${e(SEVERITY_LABEL[w.severity] ?? w.severity)}: ${e(w.text)}</li>`),
      '</ul>',
    );
  }
  html.push(
    '<h2>Legs</h2>',
    '<table><thead><tr><th class="r">#</th><th>Heading</th><th class="r">Distance</th><th class="r">Climb</th><th class="r">Arrive</th></tr></thead><tbody>',
    ...legs.map(
      (l) =>
        `<tr><td class="r">${l.n}</td><td>${e(heading(l.headingDeg))}</td><td class="r">${e(fmtDistance(l.distM))}</td><td class="r">${e(climbText(l.climbM))}</td><td class="r">${l.arriveLtstH === null ? '' : e(`${fmtClock(l.arriveLtstH)} LTST`)}</td></tr>`,
    ),
    '</tbody></table>',
    `<p class="frame">${e(MARS_FRAME)} Times are local true solar time (LTST) at each point.</p>`,
    '</body>',
    '</html>',
    '',
  );
  return html.filter((l) => l !== '').join('\n');
}
