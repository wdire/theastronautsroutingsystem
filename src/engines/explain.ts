/**
 * The route briefing: four or five plain sentences on why the route looks the way it does and what
 * the crew should know before leaving. Words only; every number comes from the trip and the path.
 */
import { ageGa, unitsAlong } from './geology';
import type { GeologyData, UnitStretch } from './geology';
import { haversineM } from './terrain';
import type { PathPoint, TripResult, Vehicle } from './types';

export interface ExplainInput {
  path: PathPoint[];
  trip: TripResult;
  vehicle: Vehicle;
  geo?: GeologyData;
  /** Straight-line distance for the same ends (through the stops, for a mission with stops), metres. */
  straightLineM: number;
  /** Where the crew stops along the path. */
  stops?: { name?: string; index: number }[];
}

const DEG = Math.PI / 180;

/** "850 m", "12.4 km". */
function distance(m: number): string {
  if (m < 995) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "45 min", "3 h", "3 h 20 min". */
function duration(s: number): string {
  const minutes = Math.max(1, Math.round(s / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "about 3.9 billion years", "about 160 million years". */
function age(ga: number): string {
  if (ga >= 1) return `about ${ga.toFixed(1)} billion years`;
  return `about ${Math.round((ga * 1000) / 10) * 10} million years`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** Distance along the path at each point, metres. */
function distancesAlong(path: readonly PathPoint[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    out.push((out[i - 1] ?? 0) + (a && b ? haversineM(a, b) : 0));
  }
  return out;
}

/** The furthest the path strays from the straight line between its ends, and to which side. */
function bend(path: readonly PathPoint[]): { offsetM: number; side: string } | null {
  const a = path[0];
  const b = path[path.length - 1];
  if (!a || !b || path.length < 3) return null;
  const kx = Math.cos(a[1] * DEG);
  const bx = (b[0] - a[0]) * kx;
  const by = b[1] - a[1];
  const len = Math.hypot(bx, by);
  if (len === 0) return null;
  let worst = 0;
  let wx = 0;
  let wy = 0;
  for (const p of path) {
    const px = (p[0] - a[0]) * kx;
    const py = p[1] - a[1];
    const t = Math.min(1, Math.max(0, (px * bx + py * by) / (len * len)));
    const ox = px - bx * t;
    const oy = py - by * t;
    const d = Math.hypot(ox, oy);
    if (d > worst) {
      worst = d;
      wx = ox;
      wy = oy;
    }
  }
  if (worst === 0) return null;
  const bearing = (Math.atan2(wx, wy) / DEG + 360) % 360;
  return {
    offsetM: worst * DEG * 3_396_190,
    side: COMPASS[Math.round(bearing / 45) % 8] ?? 'north',
  };
}

function shapeLine(input: ExplainInput, lengthM: number, hasStops: boolean): string {
  const straight = input.straightLineM;
  const noun = input.vehicle.kind === 'air' ? 'flight' : 'route';
  if (!(straight > 0)) return `The ${noun} is ${distance(lengthM)} long.`;
  const extra = lengthM / straight - 1;
  if (extra < 0.03) {
    return `The ${noun} is ${distance(lengthM)}, almost a straight line${hasStops ? ' between its stops' : ''}.`;
  }
  const first = `The ${noun} is ${distance(lengthM)}, ${Math.round(extra * 100)}% longer than the ${distance(straight)} straight line${hasStops ? ' through its stops' : ''}.`;
  if (hasStops) return first;
  const b = bend(input.path);
  if (!b || b.offsetM < Math.max(100, straight * 0.02)) return first;
  const why = input.vehicle.kind === 'air' ? '' : ` to keep to ground the ${vehicleNoun(input.vehicle)} can take`;
  return `${first} It swings up to ${distance(b.offsetM)} ${b.side} of that line${why}.`;
}

function vehicleNoun(vehicle: Vehicle): string {
  return vehicle.kind === 'walk' ? 'crew' : vehicle.kind === 'air' ? 'helicopter' : 'rover';
}

function dayLine(trip: TripResult): string {
  const base = `The trip takes ${duration(trip.totals.durationS)}`;
  const last = trip.samples[trip.samples.length - 1];
  if (!last) return `${base}.`;
  const sun = last.sunElevDeg;
  if (sun < 0) return `${base} and ends after dark, with the Sun ${Math.max(1, Math.round(-sun))} degrees below the horizon.`;
  if (sun < 10) return `${base} and ends close to sunset, with the Sun only ${Math.round(sun)} degrees up.`;
  return `${base} and ends in daylight, with the Sun ${Math.round(sun)} degrees above the horizon.`;
}

function geologyLine(stretches: UnitStretch[]): string | null {
  const first = stretches[0];
  if (!first) return null;
  const seen = new Map<string, UnitStretch>();
  for (const s of stretches) if (!seen.has(s.unit.code)) seen.set(s.unit.code, s);
  const units = [...seen.values()];
  const naming = (s: UnitStretch): string => (s.unit.name && s.unit.name !== s.unit.code ? `${s.unit.name} (${s.unit.code})` : s.unit.code);

  if (units.length === 1) {
    const ga = ageGa(first.unit);
    const old = Number.isFinite(ga) ? `, ${age(ga)} old` : '';
    return `The whole way is on one rock unit: ${naming(first)}${old}.`;
  }

  const shown = units.slice(0, 3).map(naming);
  const more = units.length - shown.length;
  const crossing = `It crosses ${plural(units.length, 'rock unit')}: ${shown.join(', then ')}${more > 0 ? `, and ${more} more` : ''}.`;

  let oldest: UnitStretch | null = null;
  let oldestGa = -Infinity;
  for (const s of units) {
    const ga = ageGa(s.unit);
    if (Number.isFinite(ga) && ga > oldestGa) {
      oldestGa = ga;
      oldest = s;
    }
  }
  if (!oldest) return crossing;
  const firstGa = ageGa(first.unit);
  if (oldest.unit.code === first.unit.code || !(oldestGa > firstGa)) {
    return `${crossing} The oldest rock on the way, ${age(oldestGa)} old, is at the start.`;
  }
  return `${crossing} Older rock, ${oldest.unit.code} at ${age(oldestGa)}, starts ${distance(oldest.fromM)} in.`;
}

function parkedLine(input: ExplainInput): string {
  const { trip } = input;
  const t = trip.totals;
  const parkedS = Math.max(0, t.durationS - t.movingS);
  if (parkedS < 60) return 'No time is spent parked: the whole trip is on the move.';
  const parts: string[] = [];
  let left = parkedS;
  if (t.workS >= 60) {
    const work = Math.min(left, t.workS);
    // The start is not a work stop; the others are named if every one of them has a name.
    const stops = (input.stops ?? []).filter((s) => s.index > 0);
    const named = stops.map((s) => s.name).filter((n): n is string => Boolean(n));
    const where =
      named.length > 0 && named.length <= 3 && named.length === stops.length
        ? ` at ${list(named)}`
        : stops.length > 0
          ? ' at the stops'
          : '';
    parts.push(`${duration(work)} of work${where}`);
    left -= work;
  }
  const nights = trip.nightStops.length;
  if (nights > 0) {
    const campS = Math.min(left, trip.nightStops.reduce((sum, n) => sum + Math.max(0, n.toUtcMs - n.fromUtcMs) / 1000, 0));
    if (campS >= 60) {
      parts.push(`${duration(campS)} camped over ${plural(nights, 'night')}`);
      left -= campS;
    }
  }
  if (left >= 60) parts.push(`${duration(left)} waiting${input.vehicle.needsDaylight ? ' for daylight' : ''}`);
  if (parts.length === 0) return `Parked time is ${duration(parkedS)} of the trip.`;
  return `Parked time is ${duration(parkedS)}: ${list(parts)}.`;
}

function limitLine(input: ExplainInput, along: number[]): string {
  const { trip, vehicle } = input;
  const at = (index: number): number => trip.samples[index]?.distM ?? along[index] ?? 0;
  if (trip.pointOfNoReturnIndex !== null) {
    return `The point of no return is ${distance(at(trip.pointOfNoReturnIndex))} in. Past it there is not enough oxygen to walk back to the start with a reserve.`;
  }
  if (trip.walkbackIndex !== null) {
    return `If the rover failed, the crew could walk home on suit air from anywhere in the first ${distance(at(trip.walkbackIndex))}. Past that they could not.`;
  }
  const t = trip.totals;
  const up = Math.round(t.climbM);
  const down = Math.round(t.descentM);
  if (vehicle.kind === 'air') return `The ground under the flight rises ${up} m and falls ${down} m.`;
  const steep = Math.round(Math.abs(t.maxGradeDeg));
  return `The route climbs ${up} m and drops ${down} m. Its steepest stretch is ${steep} degrees; the ${vehicleNoun(vehicle)} can take ${Math.round(vehicle.blockSlopeDeg)}.`;
}

/**
 * Four or five short lines, in this order: the route's shape against the straight line; how the day
 * ends; the rock units crossed and where older rock is reached (only with a geologic map and a mapped
 * route); time spent parked; and the point of no return, the walk-home limit, or the climb.
 */
export function explainRoute(input: ExplainInput): string[] {
  const { path, trip } = input;
  const along = distancesAlong(path);
  const lengthM = trip.totals.distM > 0 ? trip.totals.distM : (along[along.length - 1] ?? 0);
  const lastIndex = path.length - 1;
  const hasStops = (input.stops ?? []).some((s) => s.index > 0 && s.index < lastIndex);

  const lines: string[] = [shapeLine(input, lengthM, hasStops), dayLine(trip)];
  if (input.geo) {
    const geology = geologyLine(unitsAlong(input.geo, path));
    if (geology) lines.push(geology);
  }
  lines.push(parkedLine(input), limitLine(input, along));
  return lines;
}
