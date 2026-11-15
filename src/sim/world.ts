/**
 * The simulated world. Every function takes a world and returns a new one: no clock, no randomness outside
 * the seeded generator kept in the world, no DOM. The UI owns the real-time tick and the router.
 *
 * A running mission plays back its TripResult rather than re-deriving physics: trip.samples[i] is the state on
 * departure from path[i] (after any work, wait or camp there), and the crew is interpolated between samples.
 * After a route change the new trip starts from full tanks, and `carry` holds what earlier legs used, so the
 * numbers the crew sees stay continuous.
 */
import { lookAhead } from '@/engines/alerts';
import { SOL_S } from '@/lib/constants';
import { fmtDistance, fmtDuration, fmtPercent } from '@/lib/format';
import { bearingDeg, distanceM } from '@/lib/geo';
import type {
  Alert,
  CrewSnapshot,
  HazardZone,
  LonLat,
  MissionPlan,
  PathPoint,
  Scenario,
  TaskKind,
  TripResult,
  TripState,
  Vehicle,
} from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { pathStats } from '@/planner/geometry';
import { baseReply } from './base';
import { fireEvent, rngNext, scheduleEvents } from './events';
import { SPEEDS } from './types';
import type {
  Carry,
  LegStop,
  MissionOutcome,
  MissionRun,
  Message,
  NewRoute,
  OutcomeKind,
  Progress,
  RouteProposal,
  RunTask,
  Speed,
  World,
} from './types';

/** The clock advances in steps of at most this many simulated seconds, so nothing is stepped over. */
export const STEP_S = 60;
/** One tick never advances more than this, so a tab that slept for a day does not freeze the page. */
export const MAX_TICK_S = 7 * SOL_S;
/** Messages kept in the world; older lines drop off so snapshots stay small. */
export const MAX_MESSAGES = 300;
/** Base replies arrive this many simulated seconds after a crew line (build spec). */
export const REPLY_MIN_S = 30;
export const REPLY_MAX_S = 120;

const CLEAR: Scenario = { dust: 'clear', solarEvent: false, solarCycle: 0.5 };

const TASK_NAMES: Record<TaskKind, string> = {
  sample: 'Take a sample',
  photo: 'Photograph',
  measure: 'Measure',
  survey: 'Survey',
  custom: 'Task',
};

/* ---------- world ---------- */

export function createWorld(utcMs: number, seed = 1): World {
  return {
    utcMs: Number.isFinite(utcMs) ? utcMs : 0,
    speed: 1,
    paused: false,
    run: null,
    alerts: [],
    hazards: [],
    messages: [],
    pendingReplies: [],
    scheduled: [],
    rng: (Number.isFinite(seed) ? Math.trunc(seed) : 1) >>> 0,
    firedIds: [],
    seq: 0,
  };
}

function nextId(world: World, prefix: string): [string, World] {
  return [`${prefix}${world.seq + 1}`, { ...world, seq: world.seq + 1 }];
}

function post(world: World, from: Message['from'], text: string, atUtcMs = world.utcMs): World {
  const [id, w] = nextId(world, 'm');
  const messages = [...w.messages, { id, from, text, atUtcMs }];
  return { ...w, messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages };
}

/** Raise an alert unless one with its id was already raised in this mission. */
export function raiseAlert(world: World, alert: Alert, hazard?: HazardZone): World {
  if (world.firedIds.includes(alert.id)) return world;
  return {
    ...world,
    alerts: [...world.alerts, alert],
    firedIds: [...world.firedIds, alert.id],
    hazards: hazard ? [...world.hazards.filter((h) => h.id !== hazard.id), hazard] : world.hazards,
  };
}

export function setSpeed(world: World, speed: Speed): World {
  return SPEEDS.includes(speed) && speed !== world.speed ? { ...world, speed } : world;
}

export function setPaused(world: World, paused: boolean): World {
  return typeof paused === 'boolean' && paused !== world.paused ? { ...world, paused } : world;
}

/* ---------- timeline: the trip laid out in time ---------- */

interface Levels {
  o2Kg: number | null;
  batteryKWh: number | null;
  waterL: number | null;
  doseMSv: number;
}

/** Derived from a leg; never stored in the world. */
export interface Timeline {
  along: Float64Array;
  /** Seconds from the leg's start when the crew reaches each point. */
  arriveS: Float64Array;
  /** Seconds from the leg's start when the crew leaves each point; the gap is work, a wait or a camp. */
  departS: Float64Array;
  holdState: TripState[];
  /** Levels on leaving each point. */
  levels: Levels[];
  /** Levels at the leg's start. */
  full: Levels;
  durationS: number;
}

function capacity(v: Vehicle): { o2Kg: number; batteryKWh: number } {
  return { o2Kg: v.o2KgPerPerson * v.crew, batteryKWh: v.batteryKWh + v.extenderKWh };
}

function fin(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function holdsAt(run: Pick<MissionRun, 'legStops' | 'tasks'>): Map<number, number> {
  const out = new Map<number, number>();
  for (const ls of run.legStops) {
    const s = run.tasks.filter((t) => t.stopId === ls.stopId).reduce((sum, t) => sum + t.minutes * 60, 0);
    out.set(ls.index, (out.get(ls.index) ?? 0) + s);
  }
  return out;
}

function buildTimeline(run: Pick<MissionRun, 'path' | 'trip' | 'vehicle' | 'legStops' | 'tasks'>): Timeline {
  const v = VEHICLES[run.vehicle];
  const path = run.path;
  const n = path.length;
  const along = pathStats(path).along;
  const arriveS = new Float64Array(n);
  const departS = new Float64Array(n);
  const holdState: TripState[] = [];
  const levels: Levels[] = [];
  const samples = run.trip.samples;
  const s0 = samples[0];
  const cap = capacity(v);
  let full: Levels;
  if (s0 && s0.tS <= 0) {
    full = { o2Kg: s0.o2Kg, batteryKWh: s0.batteryKWh, waterL: s0.waterL, doseMSv: 0 };
  } else if (s0) {
    // Work or a wait at the very start: the leg began with full tanks.
    full = {
      o2Kg: s0.o2Kg === null ? null : cap.o2Kg,
      batteryKWh: s0.batteryKWh === null ? null : cap.batteryKWh,
      waterL: s0.waterL === null ? null : 0,
      doseMSv: 0,
    };
  } else {
    full = { o2Kg: null, batteryKWh: null, waterL: null, doseMSv: 0 };
  }
  const holds = holdsAt(run);
  let prevDepart = 0;
  let prev = full;
  for (let i = 0; i < n; i++) {
    const seg = i === 0 ? 0 : (along[i] ?? 0) - (along[i - 1] ?? 0);
    const s = samples[i];
    let arrive: number;
    let depart: number;
    if (s) {
      depart = Math.max(prevDepart, fin(s.tS, prevDepart));
      const dt = depart - prevDepart;
      let moveS: number;
      if (i === 0) moveS = 0;
      else if (s.state === 'move') moveS = dt;
      else {
        // The sample's time includes the hold at this point; split off the drive by the speed reached.
        const sp = s.speedMs > 0 ? s.speedMs : v.flatSpeedMs;
        moveS = sp > 0 ? Math.min(dt, seg / sp) : 0;
      }
      arrive = prevDepart + moveS;
      prev = { o2Kg: s.o2Kg, batteryKWh: s.batteryKWh, waterL: s.waterL, doseMSv: fin(s.doseMSv, prev.doseMSv) };
      holdState.push(s.state === 'move' ? 'work' : s.state);
    } else {
      // No budget for this point: the vehicle's flat speed, tasks for their minutes, levels held.
      arrive = prevDepart + (v.flatSpeedMs > 0 ? seg / v.flatSpeedMs : 0);
      depart = arrive + (holds.get(i) ?? 0);
      holdState.push('work');
    }
    arriveS[i] = arrive;
    departS[i] = depart;
    levels.push(prev);
    prevDepart = depart;
  }
  return { along, arriveS, departS, holdState, levels, full, durationS: n > 0 ? (departS[n - 1] ?? 0) : 0 };
}

const timelines = new WeakMap<TripResult, { path: PathPoint[]; legStops: LegStop[]; tl: Timeline }>();

/** The current leg laid out in time. Cached per trip, so playback costs a lookup, not a rebuild. */
export function timelineOf(run: MissionRun): Timeline {
  const hit = timelines.get(run.trip);
  if (hit && hit.path === run.path && hit.legStops === run.legStops) return hit.tl;
  const tl = buildTimeline(run);
  timelines.set(run.trip, { path: run.path, legStops: run.legStops, tl });
  return tl;
}

/** First index whose value is greater than x, or the length. */
function upperBound(a: Float64Array, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] ?? 0) > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Seconds from the leg's start until the crew first reaches a distance along the path. */
export function timeAtDistance(run: MissionRun, distM: number): number {
  const tl = timelineOf(run);
  const n = tl.along.length;
  if (n === 0 || !(distM > 0)) return 0;
  if (distM >= (tl.along[n - 1] ?? 0)) return tl.arriveS[n - 1] ?? 0;
  const i = upperBound(tl.along, distM);
  const a0 = tl.along[i - 1] ?? 0;
  const seg = (tl.along[i] ?? a0) - a0;
  const t0 = tl.departS[i - 1] ?? 0;
  const t1 = tl.arriveS[i] ?? t0;
  return t0 + (seg > 0 ? (distM - a0) / seg : 0) * (t1 - t0);
}

function lerpNullable(a: number | null, b: number | null, f: number): number | null {
  if (a === null || b === null) return b ?? a;
  return a + (b - a) * f;
}

function levelsAt(tl: Timeline, t: number): Levels {
  const n = tl.levels.length;
  const i = upperBound(tl.departS, t);
  if (i >= n) return tl.levels[n - 1] ?? tl.full;
  const t0 = i === 0 ? 0 : (tl.departS[i - 1] ?? 0);
  const l0 = i === 0 ? tl.full : (tl.levels[i - 1] ?? tl.full);
  const l1 = tl.levels[i] ?? l0;
  const span = (tl.departS[i] ?? t0) - t0;
  const f = span > 0 ? Math.min(1, Math.max(0, (t - t0) / span)) : 1;
  return {
    o2Kg: lerpNullable(l0.o2Kg, l1.o2Kg, f),
    batteryKWh: lerpNullable(l0.batteryKWh, l1.batteryKWh, f),
    waterL: lerpNullable(l0.waterL, l1.waterL, f),
    doseMSv: l0.doseMSv + (l1.doseMSv - l0.doseMSv) * f,
  };
}

interface Place {
  distM: number;
  lon: number;
  lat: number;
  elev: number;
  headingDeg: number;
  speedMs: number;
  moving: boolean;
  holdState: TripState;
}

function headingAt(path: readonly PathPoint[], i: number): number {
  const a = path[i];
  const b = path[i + 1] ?? a;
  const before = path[i - 1];
  if (a && b && b !== a) return bearingDeg(a[0], a[1], b[0], b[1]);
  if (before && a) return bearingDeg(before[0], before[1], a[0], a[1]);
  return 0;
}

function placeAt(tl: Timeline, path: readonly PathPoint[], t: number): Place {
  const n = path.length;
  const i = upperBound(tl.departS, t);
  const hold = (k: number): Place => {
    const p = path[k] ?? [0, 0, 0];
    return {
      distM: tl.along[k] ?? 0,
      lon: p[0],
      lat: p[1],
      elev: p[2],
      headingDeg: headingAt(path, k),
      speedMs: 0,
      moving: false,
      holdState: tl.holdState[k] ?? 'work',
    };
  };
  if (i >= n) return hold(n - 1);
  if (i === 0 || t >= (tl.arriveS[i] ?? 0)) return hold(i);
  const t0 = tl.departS[i - 1] ?? 0;
  const t1 = tl.arriveS[i] ?? t0;
  const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
  const a = path[i - 1] ?? [0, 0, 0];
  const b = path[i] ?? a;
  const d0 = tl.along[i - 1] ?? 0;
  const seg = (tl.along[i] ?? d0) - d0;
  return {
    distM: d0 + seg * frac,
    lon: a[0] + (b[0] - a[0]) * frac,
    lat: a[1] + (b[1] - a[1]) * frac,
    elev: a[2] + (b[2] - a[2]) * frac,
    headingDeg: bearingDeg(a[0], a[1], b[0], b[1]),
    speedMs: t1 > t0 ? seg / (t1 - t0) : 0,
    moving: true,
    holdState: 'move',
  };
}

/** Seconds into the current leg at a moment, clamped to the leg and to when the mission ended. */
export function legSeconds(run: MissionRun, utcMs: number): number {
  const tl = timelineOf(run);
  const at = run.endedUtcMs !== undefined ? Math.min(utcMs, run.endedUtcMs) : utcMs;
  return Math.min(tl.durationS, Math.max(0, (at - run.legStartUtcMs) / 1000));
}

function startLevelsOf(run: MissionRun): { o2Kg: number | null; batteryKWh: number | null } {
  const cap = capacity(VEHICLES[run.vehicle]);
  return {
    o2Kg: run.startLevels.o2Kg ?? (cap.o2Kg > 0 ? cap.o2Kg : null),
    batteryKWh: run.startLevels.batteryKWh ?? (cap.batteryKWh > 0 ? cap.batteryKWh : null),
  };
}

/** What a level reads now: what the mission started with, less earlier legs, less this leg so far. */
function reported(start: number | null, carried: number, legFull: number | null, legNow: number | null): number | null {
  if (legNow === null || legFull === null) return null;
  const base = start ?? legFull;
  return Math.max(0, base - carried - (legFull - legNow));
}

export function crewAt(run: MissionRun, utcMs: number): CrewSnapshot {
  const tl = timelineOf(run);
  const t = legSeconds(run, utcMs);
  const at = run.endedUtcMs !== undefined ? Math.min(utcMs, run.endedUtcMs) : utcMs;
  const place = placeAt(tl, run.path, t);
  const lv = levelsAt(tl, t);
  const start = startLevelsOf(run);
  const o2Kg = reported(start.o2Kg, run.carry.o2Kg, tl.full.o2Kg, lv.o2Kg);
  const batteryKWh = reported(start.batteryKWh, run.carry.batteryKWh, tl.full.batteryKWh, lv.batteryKWh);
  let state: CrewSnapshot['state'];
  if (run.status !== 'running' || (t >= tl.durationS && tl.durationS > 0) || run.path.length < 2) state = 'done';
  else if (!place.moving) state = place.holdState;
  else if (run.homeIsAhead && run.legStops.every((ls) => (tl.arriveS[ls.index] ?? 0) <= t) && (run.plan.stops.length > 0 || run.leg > 0)) {
    state = 'returning';
  } else state = 'move';
  return {
    utcMs: at,
    distM: place.distM,
    lon: place.lon,
    lat: place.lat,
    elev: place.elev,
    headingDeg: place.headingDeg,
    speedMs: place.speedMs,
    state,
    o2Kg,
    o2Frac: o2Kg !== null && start.o2Kg ? o2Kg / start.o2Kg : null,
    batteryKWh,
    batteryFrac: batteryKWh !== null && start.batteryKWh ? batteryKWh / start.batteryKWh : null,
    doseMSv: run.carry.doseMSv + lv.doseMSv,
  };
}

/** Water used so far on the whole mission, litres; null where the trip does not track it. */
export function waterUsedAt(run: MissionRun, utcMs: number): number | null {
  const lv = levelsAt(timelineOf(run), legSeconds(run, utcMs));
  return lv.waterL === null ? null : run.carry.waterL + lv.waterL;
}

/* ---------- missions ---------- */

function nearestIndex(path: readonly PathPoint[], lon: number, lat: number): number {
  let best = 0;
  let bestD = Infinity;
  path.forEach((p, i) => {
    const d = distanceM(p[0], p[1], lon, lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function stopName(plan: MissionPlan, stopId: string): string {
  const k = plan.stops.findIndex((s) => s.id === stopId);
  return plan.stops[k]?.name ?? `Stop ${k + 1}`;
}

function homeName(run: MissionRun): string {
  return run.plan.start?.name ?? 'the start';
}

function endName(run: MissionRun): string {
  if (run.homeIsAhead) return homeName(run);
  const last = run.plan.stops[run.plan.stops.length - 1];
  return last?.name ?? 'the end of the route';
}

export interface MissionInput {
  name: string;
  plan: MissionPlan;
  path: PathPoint[];
  stopIndices: number[];
  trip: TripResult;
  /** Conditions the trip was planned for; clear skies if absent. */
  scenario?: Scenario;
}

/** Start a mission at its departure. The world clock is set to the departure. */
export function startMission(world: World, input: MissionInput, departUtcMs: number): World {
  const { plan, path, stopIndices, trip } = input;
  if (!Number.isFinite(departUtcMs) || path.length === 0 || !VEHICLES[plan.vehicle]) return world;
  const [id, w0] = nextId(world, 'run');
  const tasks: RunTask[] = plan.stops.flatMap((s, k) =>
    s.tasks.map((t) => ({
      id: `${s.id}:${t.id}`,
      stopId: s.id,
      stopName: s.name ?? `Stop ${k + 1}`,
      label: t.label ?? TASK_NAMES[t.kind],
      minutes: Math.max(0, fin(t.minutes, 0)),
      state: 'todo' as const,
    })),
  );
  // stopIndices lists the start, each stop, then the end; a plan without a start may leave the start out.
  const offset = stopIndices.length >= plan.stops.length + 1 ? 1 : 0;
  const legStops: LegStop[] = plan.stops.map((s, k) => {
    const idx = stopIndices[k + offset];
    return { stopId: s.id, index: idx !== undefined && idx >= 0 && idx < path.length ? idx : nearestIndex(path, s.lon, s.lat) };
  });
  const first = path[0] ?? [0, 0, 0];
  const home: LonLat = plan.start ? [plan.start.lon, plan.start.lat] : [first[0], first[1]];
  const carry: Carry = { o2Kg: 0, batteryKWh: 0, doseMSv: 0, waterL: 0, distM: 0, timeS: 0 };
  const draft: MissionRun = {
    id,
    name: input.name,
    plan,
    vehicle: plan.vehicle,
    scenario: input.scenario ?? CLEAR,
    path,
    stopIndices,
    trip,
    startedUtcMs: departUtcMs,
    legStartUtcMs: departUtcMs,
    leg: 0,
    carry,
    startLevels: { o2Kg: null, batteryKWh: null },
    tasks,
    legStops,
    home,
    homeIsAhead: plan.roundTrip,
    status: 'running',
  };
  const tl = timelineOf(draft);
  const run: MissionRun = { ...draft, startLevels: { o2Kg: tl.full.o2Kg, batteryKWh: tl.full.batteryKWh } };
  const { events, rng } = scheduleEvents(run, w0.rng);
  let w: World = {
    ...w0,
    utcMs: departUtcMs,
    run,
    alerts: [],
    hazards: [],
    scheduled: events,
    rng,
    firedIds: [],
  };
  const stops = plan.stops.length;
  w = post(
    w,
    'system',
    `${input.name} under way: ${fmtDistance(tl.along[tl.along.length - 1] ?? 0)}${stops ? `, ${stops} ${stops === 1 ? 'stop' : 'stops'}` : ''}, about ${fmtDuration(tl.durationS)}.`,
  );
  return w;
}

/** Work tasks at the stops the crew has reached by leg time t; posts a line on arriving and on finishing. */
function updateTasks(world: World, run: MissionRun, t: number, atUtcMs: number): World {
  const tl = timelineOf(run);
  let tasks = run.tasks;
  let w = world;
  for (const ls of run.legStops) {
    const arrive = tl.arriveS[ls.index] ?? Infinity;
    if (t < arrive) continue;
    const depart = tl.departS[ls.index] ?? arrive;
    const holdS = depart - arrive;
    const elapsed = Math.min(t, depart) - arrive;
    // Leaving a stop closes its work. A little slack covers the trip's own rounding of the hold.
    const slack = Math.max(STEP_S, 0.05 * holdS);
    const mine = tasks.filter((x) => x.stopId === ls.stopId);
    if (mine.length === 0 || mine.every((x) => x.state === 'done' || x.state === 'skipped')) continue;
    const wasUntouched = mine.every((x) => x.state === 'todo');
    let offset = 0;
    const next = new Map<string, RunTask['state']>();
    for (const task of mine) {
      const start = offset;
      const end = offset + task.minutes * 60;
      offset = end;
      if (task.state === 'done' || task.state === 'skipped') continue;
      let s: RunTask['state'];
      if (t >= depart) s = end <= holdS + slack ? 'done' : 'skipped';
      else s = elapsed >= end ? 'done' : elapsed >= start ? 'doing' : 'todo';
      if (s !== task.state) next.set(task.id, s);
    }
    if (next.size === 0) continue;
    tasks = tasks.map((x) => {
      const s = next.get(x.id);
      return s ? { ...x, state: s } : x;
    });
    const after = tasks.filter((x) => x.stopId === ls.stopId);
    const name = stopName(run.plan, ls.stopId);
    if (wasUntouched && after.some((x) => x.state !== 'todo' && x.state !== 'skipped')) {
      const minutes = after.reduce((s, x) => s + x.minutes, 0);
      w = post(w, 'system', `Arrived at ${name}. ${after.length} ${after.length === 1 ? 'task' : 'tasks'}, ${fmtDuration(minutes * 60)} of work.`, atUtcMs);
    }
    if (after.every((x) => x.state === 'done' || x.state === 'skipped')) {
      const done = after.filter((x) => x.state === 'done').length;
      const skipped = after.length - done;
      w = post(
        w,
        'system',
        `Work at ${name} finished: ${done} of ${after.length} done${skipped ? `, ${skipped} skipped` : ''}.`,
        atUtcMs,
      );
    }
  }
  if (tasks === run.tasks) return w;
  return { ...w, run: w.run ? { ...w.run, tasks } : w.run };
}

function outcomeText(run: MissionRun, kind: OutcomeKind, crew: CrewSnapshot, distM: number, durationS: number): string {
  const done = run.tasks.filter((t) => t.state === 'done').length;
  const total = run.tasks.length;
  const tasks = total ? ` ${done} of ${total} ${total === 1 ? 'task' : 'tasks'} done` : '';
  const left =
    crew.o2Frac !== null
      ? `, ${fmtPercent(crew.o2Frac)} oxygen left`
      : crew.batteryFrac !== null
        ? `, ${fmtPercent(crew.batteryFrac)} battery left`
        : '';
  const span = `${fmtDuration(durationS)} and ${fmtDistance(distM)}`;
  switch (kind) {
    case 'home':
      return `Back at ${homeName(run)} after ${span}.${tasks}${left}.`;
    case 'arrived':
      return `Arrived at ${endName(run)} after ${span}.${tasks}${left}.`;
    case 'aborted':
      return `Mission stopped after ${span}.${tasks ? `${tasks}.` : ''}`;
    case 'stranded':
      return crew.o2Kg !== null && crew.o2Kg <= 0
        ? `Oxygen ran out after ${span}, short of ${endName(run)}. On a real traverse this is the line the plan must never cross.`
        : `The battery ran flat after ${span}, short of ${endName(run)}.`;
  }
}

function finish(world: World, kind: OutcomeKind, atUtcMs: number): World {
  const run = world.run;
  if (!run || run.status !== 'running') return world;
  const crew = crewAt(run, atUtcMs);
  const t = legSeconds(run, atUtcMs);
  const tasks = run.tasks.map((x) => (x.state === 'todo' || x.state === 'doing' ? { ...x, state: 'skipped' as const } : x));
  const ended: MissionRun = { ...run, tasks };
  const distM = run.carry.distM + crew.distM;
  const durationS = run.carry.timeS + t;
  const outcome: MissionOutcome = {
    kind,
    atUtcMs,
    text: outcomeText(ended, kind, crew, distM, durationS),
    tasksDone: tasks.filter((x) => x.state === 'done').length,
    tasksTotal: tasks.length,
    distM,
    durationS,
    o2Frac: crew.o2Frac,
    batteryFrac: crew.batteryFrac,
    doseMSv: crew.doseMSv,
  };
  const status = kind === 'aborted' ? 'aborted' : 'done';
  const w: World = {
    ...world,
    run: { ...ended, status, endedUtcMs: atUtcMs, outcome },
    scheduled: [],
    alerts: world.alerts.map((a) => (a.resolved ? a : { ...a, resolved: 'expired' as const })),
  };
  return post(w, 'system', outcome.text, atUtcMs);
}

export function abortMission(world: World): World {
  return finish(world, 'aborted', world.utcMs);
}

/* ---------- tick ---------- */

function deliverReplies(world: World, untilUtcMs: number): World {
  const due = world.pendingReplies.filter((r) => r.dueUtcMs <= untilUtcMs).sort((a, b) => a.dueUtcMs - b.dueUtcMs);
  if (due.length === 0) return world;
  let w: World = { ...world, pendingReplies: world.pendingReplies.filter((r) => r.dueUtcMs > untilUtcMs) };
  for (const r of due) {
    const run = w.run;
    const crew = run ? crewAt(run, r.dueUtcMs) : null;
    w = post(w, 'base', baseReply(r.question, crew, run, r.dueUtcMs), r.dueUtcMs);
  }
  return w;
}

function stepRun(world: World, t1: number): World {
  let w = world;
  const run0 = w.run;
  if (!run0 || run0.status !== 'running') return w;
  const tl = timelineOf(run0);
  const legEndMs = run0.legStartUtcMs + tl.durationS * 1000;
  const at = Math.min(t1, legEndMs);
  w = updateTasks(w, run0, legSeconds(run0, at), at);

  // Scheduled events in time order, each from the crew's state at its own moment.
  const due = w.scheduled.filter((e) => e.atUtcMs <= at).sort((a, b) => a.atUtcMs - b.atUtcMs);
  if (due.length) {
    w = { ...w, scheduled: w.scheduled.filter((e) => e.atUtcMs > at) };
    for (const ev of due) w = fireEvent(w, ev, Math.max(ev.atUtcMs, world.utcMs));
  }

  const run = w.run;
  if (!run || run.status !== 'running') return w;
  const crew = crewAt(run, at);
  for (const a of lookAhead({
    run,
    crew,
    along: tl.along,
    secondsTo: (i) => tl.arriveS[i] ?? null,
    endUtcMs: legEndMs,
  })) {
    w = raiseAlert(w, a);
  }

  const v = VEHICLES[run.vehicle];
  const outOfAir = v.crew > 0 && crew.o2Kg !== null && crew.o2Kg <= 0;
  const flat = v.kind !== 'walk' && crew.batteryKWh !== null && crew.batteryKWh <= 0;
  if (outOfAir || flat) return finish(w, 'stranded', at);
  if (t1 >= legEndMs) return finish(w, run.homeIsAhead ? 'home' : 'arrived', legEndMs);
  return w;
}

/**
 * Advance the world by realSeconds times its speed, in steps of at most STEP_S simulated seconds.
 * The clock only moves forward; a negative, zero or non-finite step, or a paused world, changes nothing.
 */
export function tick(world: World, realSeconds: number): World {
  if (!(realSeconds > 0) || !Number.isFinite(realSeconds) || world.paused) return world;
  let remaining = Math.min(MAX_TICK_S, realSeconds * world.speed);
  let w = world;
  while (remaining > 1e-9) {
    const active = w.run?.status === 'running';
    // Without a running mission only replies can happen, so the clock can jump to the next of them.
    const dt = active ? Math.min(STEP_S, remaining) : remaining;
    const t1 = w.utcMs + dt * 1000;
    w = stepRun(w, t1);
    w = deliverReplies(w, t1);
    w = { ...w, utcMs: Math.max(w.utcMs, t1) };
    remaining -= dt;
  }
  return w;
}

/* ---------- chat ---------- */

/** A crew line. The base answers 30 to 120 simulated seconds later. */
export function say(world: World, text: string): World {
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) return world;
  const w = post(world, 'crew', clean);
  const [r, rng] = rngNext(w.rng);
  const delayS = REPLY_MIN_S + Math.floor(r * (REPLY_MAX_S - REPLY_MIN_S + 1));
  const [id, w2] = nextId({ ...w, rng }, 'r');
  return { ...w2, pendingReplies: [...w2.pendingReplies, { id, dueUtcMs: w.utcMs + delayS * 1000, question: clean }] };
}

/* ---------- alerts ---------- */

function resolve(world: World, alertId: string, resolved: 'applied' | 'ignored'): World {
  let changed = false;
  const alerts = world.alerts.map((a) => {
    if (a.id !== alertId || a.resolved) return a;
    changed = true;
    return { ...a, resolved };
  });
  return changed ? { ...world, alerts } : world;
}

export function ignoreAlert(world: World, alertId: string): World {
  return resolve(world, alertId, 'ignored');
}

/**
 * Apply an alert whose action needs no new route (shelter, wait, slow down). Reroutes and turn backs go
 * through proposal() and adoptRoute(), because they need the router.
 */
export function applyAlert(world: World, alertId: string): World {
  const alert = world.alerts.find((a) => a.id === alertId && !a.resolved);
  if (!alert?.action || alert.action.kind === 'reroute' || alert.action.kind === 'turnBack') return world;
  return post(resolve(world, alertId, 'applied'), 'system', `${alert.action.label}: done.`);
}

/** Stops on the current leg the crew has not left yet (including one it is working at), in path order. */
function stopsAhead(run: MissionRun, t: number): LegStop[] {
  const tl = timelineOf(run);
  return run.legStops.filter((ls) => (tl.departS[ls.index] ?? 0) > t).sort((a, b) => a.index - b.index);
}

/** What the router needs for an alert that proposes a new route; null for any other alert. */
export function proposal(world: World, alertId: string): RouteProposal | null {
  const run = world.run;
  const alert = world.alerts.find((a) => a.id === alertId);
  const kind = alert?.action?.kind;
  if (!run || run.status !== 'running' || !alert || alert.resolved || (kind !== 'reroute' && kind !== 'turnBack')) return null;
  const crew = crewAt(run, world.utcMs);
  const t = legSeconds(run, world.utcMs);
  const home = { lon: run.home[0], lat: run.home[1], ...(run.plan.start?.name ? { name: run.plan.start.name } : {}) };
  let via: RouteProposal['via'];
  let homeIsAhead: boolean;
  if (kind === 'turnBack') {
    via = [home];
    homeIsAhead = true;
  } else {
    via = stopsAhead(run, t).map((ls) => {
      const s = run.plan.stops.find((x) => x.id === ls.stopId);
      const p = run.path[ls.index];
      return {
        lon: s?.lon ?? p?.[0] ?? crew.lon,
        lat: s?.lat ?? p?.[1] ?? crew.lat,
        ...(s?.name ? { name: s.name } : {}),
        ...(p ? { elev: p[2] } : {}),
        stopId: ls.stopId,
      };
    });
    homeIsAhead = run.homeIsAhead;
    const end = run.path[run.path.length - 1];
    const last = via[via.length - 1];
    if (homeIsAhead) via.push(home);
    else if (end && (!last || distanceM(last.lon, last.lat, end[0], end[1]) > 5)) via.push({ lon: end[0], lat: end[1] });
  }
  // A zone over the crew or over a place it must reach cannot be routed around, only waited out: the router
  // would refuse the whole route. Such a zone is left to the crew's judgement instead of blocking the way home.
  const ends: [number, number][] = [[crew.lon, crew.lat], ...via.map((v): [number, number] => [v.lon, v.lat])];
  const hazards = world.hazards.filter((h) => !ends.some(([lon, lat]) => distanceM(lon, lat, h.lon, h.lat) <= h.radiusM + 30));
  return {
    alertId,
    action: kind,
    from: [crew.lon, crew.lat],
    via,
    hazards,
    vehicle: run.vehicle,
    departUtcMs: world.utcMs,
    homeIsAhead,
  };
}

function changeWords(alert: Alert | undefined): string {
  const id = alert?.id ?? '';
  if (id.startsWith('dust')) return ' around the dust devil';
  if (id.startsWith('steep')) return ' around the steep ground';
  if (id.startsWith('storm')) return ' away from the storm';
  return '';
}

/**
 * Take a new route for a reroute or turn-back alert. What the mission spent so far moves into `carry`, so
 * oxygen, battery and dose carry on from where they were; the alert is marked applied and a system line
 * says what changed. The caller routed from proposal().from, which the crew is still at unless the clock ran.
 */
export function adoptRoute(world: World, alertId: string, route: NewRoute): World {
  const p = proposal(world, alertId);
  const run = world.run;
  if (!p || !run || !Array.isArray(route.path) || route.path.length === 0) return world;
  const crew = crewAt(run, world.utcMs);
  const t = legSeconds(run, world.utcMs);
  const oldTl = timelineOf(run);
  const start = startLevelsOf(run);
  const water = waterUsedAt(run, world.utcMs);
  const carry: Carry = {
    o2Kg: start.o2Kg !== null && crew.o2Kg !== null ? start.o2Kg - crew.o2Kg : run.carry.o2Kg,
    batteryKWh: start.batteryKWh !== null && crew.batteryKWh !== null ? start.batteryKWh - crew.batteryKWh : run.carry.batteryKWh,
    doseMSv: crew.doseMSv,
    waterL: water ?? run.carry.waterL,
    distM: run.carry.distM + crew.distM,
    timeS: run.carry.timeS + t,
  };
  const legStops: LegStop[] = [];
  p.via.forEach((v, k) => {
    if (!v.stopId) return;
    const idx = route.stopIndices[k + 1];
    legStops.push({
      stopId: v.stopId,
      index: idx !== undefined && idx >= 0 && idx < route.path.length ? idx : nearestIndex(route.path, v.lon, v.lat),
    });
  });
  const kept = new Set(legStops.map((ls) => ls.stopId));
  const tasks = run.tasks.map((x) =>
    !kept.has(x.stopId) && (x.state === 'todo' || x.state === 'doing') ? { ...x, state: 'skipped' as const } : x,
  );
  const next: MissionRun = {
    ...run,
    path: route.path,
    stopIndices: route.stopIndices,
    trip: route.trip,
    legStartUtcMs: world.utcMs,
    leg: run.leg + 1,
    carry,
    // Fix what the mission started with now, so a first leg without a budget does not leave fractions undefined.
    startLevels: start,
    tasks,
    legStops,
    homeIsAhead: p.homeIsAhead,
  };
  const newTl = timelineOf(next);
  const newDist = newTl.along[newTl.along.length - 1] ?? 0;
  const oldLeft = Math.max(0, (oldTl.along[oldTl.along.length - 1] ?? 0) - crew.distM);
  const dd = newDist - oldLeft;
  const dt = newTl.durationS - Math.max(0, oldTl.durationS - t);
  const alert = world.alerts.find((a) => a.id === alertId);
  let text: string;
  if (p.action === 'turnBack') {
    const dropped = tasks.filter((x, i) => x.state === 'skipped' && run.tasks[i]?.state !== 'skipped').length;
    text = `Turning back for ${homeName(run)}: ${fmtDistance(newDist)} to go, about ${fmtDuration(newTl.durationS)}.${dropped ? ` ${dropped} ${dropped === 1 ? 'task' : 'tasks'} dropped.` : ''}`;
  } else {
    const dist = Math.abs(dd) < 10 ? 'the same length' : `${fmtDistance(Math.abs(dd))} ${dd > 0 ? 'longer' : 'shorter'}`;
    const time = Math.abs(dt) < 30 ? 'about the same time' : `${fmtDuration(Math.abs(dt))} ${dt > 0 ? 'more' : 'less'}`;
    text = `New route${changeWords(alert)}: ${dist}, ${time}.`;
  }
  const w = resolve({ ...world, run: next }, alertId, 'applied');
  return post(w, 'system', text);
}

/* ---------- progress ---------- */

export function progress(run: MissionRun, utcMs: number): Progress {
  const tl = timelineOf(run);
  const t = legSeconds(run, utcMs);
  const crew = crewAt(run, utcMs);
  const total = run.carry.timeS + tl.durationS;
  const done = run.status !== 'running' || t >= tl.durationS;
  const fraction = done ? 1 : total > 0 ? Math.min(1, (run.carry.timeS + t) / total) : 0;
  const tasksDone = run.tasks.filter((x) => x.state === 'done').length;
  const next = run.legStops
    .filter((ls) => (tl.departS[ls.index] ?? 0) > t)
    .sort((a, b) => a.index - b.index)[0];
  const n = run.path.length;
  if (next && !done) {
    return {
      fraction,
      nextName: stopName(run.plan, next.stopId),
      nextDistM: Math.max(0, (tl.along[next.index] ?? 0) - crew.distM),
      nextS: Math.max(0, (tl.arriveS[next.index] ?? 0) - t),
      tasksDone,
      tasksTotal: run.tasks.length,
    };
  }
  return {
    fraction,
    nextName: run.homeIsAhead ? homeName(run) : endName(run),
    nextDistM: done ? 0 : Math.max(0, (tl.along[n - 1] ?? 0) - crew.distM),
    nextS: done ? 0 : Math.max(0, (tl.arriveS[n - 1] ?? 0) - t),
    tasksDone,
    tasksTotal: run.tasks.length,
  };
}
