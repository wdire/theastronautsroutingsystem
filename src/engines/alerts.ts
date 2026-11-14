/**
 * Look-ahead alerts: what a crew should hear about the next few hundred metres and the next few minutes.
 * Pure: the same run and crew snapshot always give the same alerts. Each alert id names its kind and the
 * place or moment it refers to, so the world can raise it once however many times it is computed.
 */
import { marsTime, sunriseSunset } from './marsTime';
import type { Alert, CrewSnapshot, PathPoint, Severity, TripResult, VehicleId } from './types';
import { VEHICLES } from './vehicles';
import { distanceM } from '@/lib/geo';
import { fmtDistance, fmtDuration } from '@/lib/format';

/** One severity, one rank: warning > caution > advisory > note. */
export const SEVERITY_RANK: Record<Severity, number> = { warning: 3, caution: 2, advisory: 1, note: 0 };

/** Most severe first; within a severity, the newest first. Returns a new array. */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.atUtcMs - a.atUtcMs);
}

/** How far ahead to look for steep ground, m (design: steep ground in 300 m). */
export const STEEP_LOOKAHEAD_M = 300;
/** Warn this long before the point of no return, s. */
export const PNR_WARN_S = 10 * 60;
/** Sunset warnings for vehicles that need daylight, s. */
export const SUNSET_ADVISORY_S = 40 * 60;
export const SUNSET_CAUTION_S = 15 * 60;
/** Oxygen reserve: below this share of what was carried, head home. */
export const O2_RESERVE_FRAC = 0.2;
export const BATTERY_LOW_FRAC = 0.15;
/** Grade is measured over this much ground, so one noisy height does not read as a cliff, m. */
const GRADE_BASE_M = 60;
/** A steep stretch is followed back at most this far to find where it begins, m. */
const STRETCH_BACK_M = 2000;

/** The parts of a running mission the look-ahead reads. A MissionRun fits. */
export interface LookAheadRun {
  vehicle: VehicleId;
  path: readonly PathPoint[];
  trip: TripResult;
  legStartUtcMs: number;
}

export interface LookAheadInput {
  run: LookAheadRun;
  crew: CrewSnapshot;
  /** Distance from the start of the path to each point, m. Computed when absent. */
  along?: ArrayLike<number>;
  /** Seconds from the leg's start until the crew reaches a path index; defaults to the trip samples. */
  secondsTo?: (index: number) => number | null;
  /** When the current leg ends; defaults to the trip's duration. */
  endUtcMs?: number;
}

function alongOf(path: readonly PathPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    out.push((out[i - 1] ?? 0) + (a && b ? distanceM(a[0], a[1], b[0], b[1]) : 0));
  }
  return out;
}

/** Unsigned grade arriving at point i, over at least GRADE_BASE_M of ground behind it, degrees. */
function gradeAt(path: readonly PathPoint[], along: ArrayLike<number>, i: number): number {
  const pi = path[i];
  if (!pi || i === 0) return 0;
  let j = i - 1;
  while (j > 0 && (along[i] ?? 0) - (along[j] ?? 0) < GRADE_BASE_M) j--;
  const pj = path[j];
  const run = (along[i] ?? 0) - (along[j] ?? 0);
  if (!pj || run < 0.5) return 0;
  return (Math.atan(Math.abs(pi[2] - pj[2]) / run) * 180) / Math.PI;
}

function placeKey(p: readonly [number, number, ...number[]] | undefined): string {
  return p ? `${p[0].toFixed(4)},${p[1].toFixed(4)}` : 'none';
}

/** Index of the first point at or beyond a distance along the path. */
function indexAtOrAfter(along: ArrayLike<number>, distM: number): number {
  let lo = 0;
  let hi = along.length - 1;
  if (hi < 0) return 0;
  if ((along[hi] ?? 0) < distM) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((along[mid] ?? 0) < distM) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function steepAlert(input: LookAheadInput, along: ArrayLike<number>): Alert | null {
  const { run, crew } = input;
  const v = VEHICLES[run.vehicle];
  const path = run.path;
  if (v.kind === 'air' || path.length < 2) return null;
  const from = indexAtOrAfter(along, crew.distM);
  let first = -1;
  for (let i = from; i < path.length && (along[i] ?? 0) - crew.distM <= STEEP_LOOKAHEAD_M; i++) {
    if (gradeAt(path, along, i) > v.comfortSlopeDeg) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;
  // Walk back to where the stretch begins, so the id stays the same while the crew drives through it.
  let start = first;
  while (
    start > 1 &&
    gradeAt(path, along, start - 1) > v.comfortSlopeDeg &&
    (along[first] ?? 0) - (along[start - 1] ?? 0) <= STRETCH_BACK_M
  ) {
    start--;
  }
  let maxGrade = 0;
  let steepest = first;
  for (let i = start; i < path.length && (along[i] ?? 0) - crew.distM <= STEEP_LOOKAHEAD_M; i++) {
    const g = gradeAt(path, along, i);
    if (g > maxGrade) {
      maxGrade = g;
      steepest = i;
    }
  }
  const severity: Severity = maxGrade > v.blockSlopeDeg ? 'warning' : 'caution';
  const ahead = Math.max(0, (along[first] ?? 0) - crew.distM);
  const where = ahead < 20 ? 'Here' : `${fmtDistance(ahead)} ahead`;
  const deg = Math.round(maxGrade);
  const p = path[steepest];
  const limit = severity === 'warning' ? v.blockSlopeDeg : v.comfortSlopeDeg;
  return {
    id: `steep:${severity}:${placeKey(path[start])}`,
    severity,
    title: severity === 'warning' ? 'Too steep ahead' : 'Steep ground ahead',
    body:
      severity === 'warning'
        ? `${where} the ground reaches ${deg}°, past the ${limit}° this vehicle can climb. Find a way around.`
        : `${where} the ground reaches ${deg}°, above the ${limit}° this vehicle takes comfortably. Expect to slow down.`,
    source: 'lookahead',
    atUtcMs: crew.utcMs,
    ...(p ? { position: [p[0], p[1]] as const } : {}),
    ...(severity === 'warning' ? { action: { kind: 'reroute' as const, label: 'Route around it' } } : {}),
    speak: severity === 'warning' ? `Too steep ahead, ${deg} degrees.` : `Steep ground ahead, ${deg} degrees.`,
  };
}

function defaultSecondsTo(run: LookAheadRun, along: ArrayLike<number>, crew: CrewSnapshot, index: number): number | null {
  const s = run.trip.samples[index];
  if (s) return s.tS;
  // Without samples, assume the vehicle's flat speed from where the crew is now.
  const v = VEHICLES[run.vehicle];
  if (!(v.flatSpeedMs > 0)) return null;
  const nowS = (crew.utcMs - run.legStartUtcMs) / 1000;
  return nowS + Math.max(0, (along[index] ?? 0) - crew.distM) / v.flatSpeedMs;
}

function pointOfNoReturnAlert(input: LookAheadInput, along: ArrayLike<number>): Alert | null {
  const { run, crew } = input;
  const idx = run.trip.pointOfNoReturnIndex;
  if (idx === null || idx < 0 || idx >= run.path.length) return null;
  if ((along[idx] ?? 0) <= crew.distM) return null;
  const t = input.secondsTo ? input.secondsTo(idx) : defaultSecondsTo(run, along, crew, idx);
  if (t === null) return null;
  const inS = run.legStartUtcMs + t * 1000 - crew.utcMs;
  if (!(inS > 0 && inS <= PNR_WARN_S * 1000)) return null;
  const p = run.path[idx];
  const minutes = fmtDuration(Math.max(60, inS / 1000));
  return {
    id: `pnr:${placeKey(p)}`,
    severity: 'caution',
    title: 'Point of no return soon',
    body: `In about ${minutes}, ${fmtDistance((along[idx] ?? 0) - crew.distM)} ahead, the crew passes the point of no return. Beyond it the air left will not bring them home with a reserve.`,
    source: 'lookahead',
    atUtcMs: crew.utcMs,
    ...(p ? { position: [p[0], p[1]] as const } : {}),
    action: { kind: 'turnBack', label: 'Turn back now' },
    speak: `Point of no return in ${minutes.replace('min', 'minutes')}.`,
  };
}

function sunsetAlert(input: LookAheadInput): Alert | null {
  const { run, crew } = input;
  const v = VEHICLES[run.vehicle];
  if (!v.needsDaylight || crew.state === 'camp' || crew.state === 'done') return null;
  const { setUtcMs, dayLengthS } = sunriseSunset(crew.utcMs, crew.lat, crew.lon);
  if (dayLengthS <= 0) return null;
  const inMs = setUtcMs - crew.utcMs;
  if (!(inMs > 0 && inMs <= SUNSET_ADVISORY_S * 1000)) return null;
  const endUtcMs =
    input.endUtcMs ?? (run.trip.totals.durationS > 0 ? run.legStartUtcMs + run.trip.totals.durationS * 1000 : Infinity);
  // A crew that will be done before dark has nothing to hear.
  if (endUtcMs <= setUtcMs) return null;
  const severity: Severity = inMs <= SUNSET_CAUTION_S * 1000 ? 'caution' : 'advisory';
  const sol = marsTime(setUtcMs, crew.lon).sol;
  const left = fmtDuration(inMs / 1000);
  return {
    id: `sunset:${sol}:${severity}`,
    severity,
    title: 'Sunset soon',
    body: `The sun sets in ${left} and the route runs on past it. ${v.name} needs daylight: find a place to stop or head back.`,
    source: 'lookahead',
    atUtcMs: crew.utcMs,
    speak: `Sunset in ${left.replace('min', 'minutes')}.`,
  };
}

function oxygenAlert(input: LookAheadInput): Alert | null {
  const { crew } = input;
  if (crew.o2Frac === null || crew.o2Kg === null || crew.o2Frac > O2_RESERVE_FRAC) return null;
  const pct = Math.max(0, Math.round(crew.o2Frac * 100));
  return {
    id: 'o2:reserve',
    severity: 'warning',
    title: 'Oxygen at reserve',
    body: `Oxygen is down to ${pct}% (${crew.o2Kg.toFixed(2)} kg). The reserve is for getting home: turn back now.`,
    source: 'lookahead',
    atUtcMs: crew.utcMs,
    position: [crew.lon, crew.lat],
    action: { kind: 'turnBack', label: 'Turn back for home' },
    speak: `Oxygen at ${pct} percent. Turn back.`,
  };
}

function batteryAlert(input: LookAheadInput): Alert | null {
  const { crew } = input;
  if (crew.batteryFrac === null || crew.batteryKWh === null || crew.batteryFrac >= BATTERY_LOW_FRAC) return null;
  const pct = Math.max(0, Math.round(crew.batteryFrac * 100));
  return {
    id: 'battery:low',
    severity: 'caution',
    title: 'Battery low',
    body: `The battery is at ${pct}% (${crew.batteryKWh.toFixed(1)} kWh). Drive gently and keep the rest for getting back.`,
    source: 'lookahead',
    atUtcMs: crew.utcMs,
    speak: `Battery at ${pct} percent.`,
  };
}

/** Every look-ahead alert true for this crew at this moment, most severe first. */
export function lookAhead(input: LookAheadInput): Alert[] {
  if (input.crew.state === 'done') return [];
  const along = input.along ?? alongOf(input.run.path);
  const out: Alert[] = [];
  for (const a of [
    steepAlert(input, along),
    pointOfNoReturnAlert(input, along),
    sunsetAlert(input),
    oxygenAlert(input),
    batteryAlert(input),
  ]) {
    if (a) out.push(a);
  }
  return sortAlerts(out);
}
