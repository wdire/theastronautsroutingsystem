/**
 * The run as it travels between browsers. The commander's world is split in two: a small live snapshot sent
 * about once a second, and the route (path, stops, trip samples) sent only when it changes. A member puts the
 * two back together. Everything read here comes from another browser, so it is checked before it is used,
 * the same way src/sim/sync.ts checks a BroadcastChannel message.
 */
import type { PathPoint, TripResult, TripSample } from '@/engines/types';
import { isWorld } from '@/sim/sync';
import type { MissionRun, World } from '@/sim/types';

/** What the original route promised, kept with every snapshot so a debrief can compare. */
export interface Planned {
  departUtcMs: number;
  durationS: number;
  distM: number;
  /** Oxygen and battery left at the end, as a fraction of what was carried. Null where the vehicle has none. */
  o2EndFrac: number | null;
  batteryEndFrac: number | null;
  doseMSv: number;
}

type StrippedRun = Omit<MissionRun, 'path' | 'stopIndices' | 'trip'>;
export type StrippedWorld = Omit<World, 'run'> & { run: StrippedRun | null };

export interface LiveSnapshot {
  v: 1;
  /** The route leg this snapshot runs on; it must match the route it is joined with. */
  leg: number;
  world: StrippedWorld;
  planned: Planned | null;
  /** Whether the commander's clock was moving when this was sent, so a member can run its own on between snapshots. */
  ticking?: boolean;
}

export interface RouteDoc {
  leg: number;
  path: PathPoint[];
  stopIndices: number[];
  trip: TripResult;
}

// Columns for the trip samples: one row per path point, so the key names are not repeated thousands of times.
const SAMPLE_KEYS = ['distM', 'tS', 'utcMs', 'elev', 'gradeDeg', 'speedMs', 'state', 'o2Kg', 'batteryKWh', 'waterL', 'doseMSv', 'tempC', 'tau', 'sunElevDeg'] as const satisfies readonly (keyof TripSample)[];
const STATES = ['move', 'work', 'wait', 'camp'];

/** Six decimals keep a longitude to about 6 cm; anything finer is noise and only costs bytes. */
function round(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e6) / 1e6 : value;
}

export function encode(value: unknown): string {
  return JSON.stringify(value, round);
}

/** The planned figures from the route the mission set out on. */
export function plannedFrom(trip: TripResult, departUtcMs: number, startLevels: MissionRun['startLevels']): Planned {
  const last = trip.samples[trip.samples.length - 1];
  const o2 = last?.o2Kg ?? null;
  const bat = last?.batteryKWh ?? null;
  return {
    departUtcMs,
    durationS: trip.totals.durationS,
    distM: trip.totals.distM,
    o2EndFrac: o2 !== null && startLevels.o2Kg ? o2 / startLevels.o2Kg : null,
    batteryEndFrac: bat !== null && startLevels.batteryKWh ? bat / startLevels.batteryKWh : null,
    doseMSv: trip.totals.doseMSv,
  };
}

/** The live snapshot of a world, without its route. */
export function stripWorld(world: World, planned: Planned | null): LiveSnapshot {
  const run = world.run;
  let stripped: StrippedRun | null = null;
  if (run) {
    const { path: _path, stopIndices: _stops, trip: _trip, ...rest } = run;
    void _path;
    void _stops;
    void _trip;
    stripped = rest;
  }
  return { v: 1, leg: run?.leg ?? 0, world: { ...world, run: stripped }, planned };
}

export function routeOf(run: MissionRun): RouteDoc {
  return { leg: run.leg, path: run.path, stopIndices: run.stopIndices, trip: run.trip };
}

export function encodeSnapshot(world: World, planned: Planned | null, ticking: boolean): string {
  return encode({ ...stripWorld(world, planned), ticking });
}

export function encodeRoute(route: RouteDoc): string {
  const { samples, ...trip } = route.trip;
  return encode({ v: 1, leg: route.leg, path: route.path, stopIndices: route.stopIndices, trip: { ...trip, samples: { keys: SAMPLE_KEYS, rows: samples.map((s) => SAMPLE_KEYS.map((k) => s[k])) } } });
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parsePlanned(x: unknown): Planned | null {
  if (!isObj(x)) return null;
  if (!isNum(x.departUtcMs) || !isNum(x.durationS) || !isNum(x.distM) || !isNum(x.doseMSv) || !isNumOrNull(x.o2EndFrac) || !isNumOrNull(x.batteryEndFrac)) return null;
  return { departUtcMs: x.departUtcMs, durationS: x.durationS, distM: x.distM, o2EndFrac: x.o2EndFrac, batteryEndFrac: x.batteryEndFrac, doseMSv: x.doseMSv };
}

/** A live snapshot if the text is a well-formed one, else null. The world inside is checked when it is rebuilt. */
export function parseSnapshot(json: string): LiveSnapshot | null {
  const x = parse(json);
  if (!isObj(x) || x.v !== 1 || !isNum(x.leg) || !isObj(x.world)) return null;
  const world = x.world;
  if (world.run !== null && !isObj(world.run)) return null;
  return { v: 1, leg: x.leg, world: world as unknown as StrippedWorld, planned: parsePlanned(x.planned), ...(typeof x.ticking === 'boolean' ? { ticking: x.ticking } : {}) };
}

/** A route if the text is a well-formed one, else null. */
export function parseRoute(json: string): RouteDoc | null {
  const x = parse(json);
  if (!isObj(x) || x.v !== 1 || !isNum(x.leg) || !Array.isArray(x.path) || !Array.isArray(x.stopIndices) || !isObj(x.trip)) return null;
  const packed = x.trip.samples;
  if (!isObj(packed) || !Array.isArray(packed.keys) || !Array.isArray(packed.rows)) return null;
  const keys = packed.keys;
  if (keys.length !== SAMPLE_KEYS.length || !keys.every((k, i) => k === SAMPLE_KEYS[i])) return null;
  const samples: TripSample[] = [];
  for (const row of packed.rows) {
    if (!Array.isArray(row) || row.length !== SAMPLE_KEYS.length) return null;
    const s: Record<string, unknown> = {};
    SAMPLE_KEYS.forEach((k, i) => (s[k] = row[i]));
    if (!isNum(s.distM) || !isNum(s.tS) || !isNum(s.utcMs) || !STATES.includes(s.state as string)) return null;
    if (!isNumOrNull(s.o2Kg) || !isNumOrNull(s.batteryKWh) || !isNumOrNull(s.waterL)) return null;
    samples.push(s as unknown as TripSample);
  }
  const trip = { ...x.trip, samples } as unknown as TripResult;
  if (!isObj(trip.totals) || !Array.isArray(trip.warnings) || !Array.isArray(trip.nightStops)) return null;
  return { leg: x.leg, path: x.path as PathPoint[], stopIndices: x.stopIndices as number[], trip };
}

/**
 * Joins a snapshot with its route into a world the run panel, the map and Rover View can use. Null when the
 * route is for another leg (the new one is still on its way) or the result does not hold together.
 */
export function rebuildWorld(snapshot: LiveSnapshot, route: RouteDoc | null): World | null {
  const run = snapshot.world.run;
  if (!run) return isWorld(snapshot.world) ? (snapshot.world as World) : null;
  if (!route || route.leg !== snapshot.leg) return null;
  const world: unknown = { ...snapshot.world, run: { ...run, path: route.path, stopIndices: route.stopIndices, trip: route.trip } };
  if (!isWorld(world)) return null;
  // crewAt indexes samples by path point, so the two must line up.
  const n = world.run?.trip.samples.length ?? 0;
  if (world.run && n !== 0 && n !== world.run.path.length) return null;
  return world;
}
