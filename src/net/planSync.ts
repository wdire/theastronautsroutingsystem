/**
 * The plan as the commander shares it. The commander's edits go out after a short pause, so dragging a pin
 * sends one update and not fifty; a member loads each new revision into their own planner, which works the
 * route out again locally. The plan comes from another browser, so it is checked field by field.
 */
import type { MissionPlan, RouteStyle, Stop, Task, TaskKind, Waypoint } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';

export const PLAN_DEBOUNCE_MS = 800;

export interface SharedPlan {
  plan: MissionPlan;
  /** The ready-made mission it came from (src/engines/missions.ts), which has a rule for success. */
  templateId: string | null;
}

interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

/** Sends the latest value once nothing new has come for `ms`. `flush` sends a waiting value at once. */
export function createDebounce<T>(ms: number, send: (value: T) => void, timers: Timers = browserTimers) {
  let timer = 0;
  let waiting: { value: T } | null = null;
  const fire = () => {
    timer = 0;
    const w = waiting;
    waiting = null;
    if (w) send(w.value);
  };
  return {
    push(value: T) {
      waiting = { value };
      if (timer) timers.clear(timer);
      timer = timers.set(fire, ms);
    },
    flush() {
      if (timer) timers.clear(timer);
      fire();
    },
    cancel() {
      if (timer) timers.clear(timer);
      timer = 0;
      waiting = null;
    },
    pending: () => waiting !== null,
  };
}

export function encodePlan(shared: SharedPlan): string {
  return JSON.stringify({ v: 1, ...shared });
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const KINDS: readonly TaskKind[] = ['sample', 'photo', 'measure', 'survey', 'custom'];
const STYLES: readonly RouteStyle[] = ['safest', 'fastest', 'eco'];
const MAX_STOPS = 50;
const MAX_TASKS = 30;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const optStr = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x.length > 0 ? x.slice(0, max) : undefined);

function waypoint(x: unknown): Waypoint | null {
  if (!isObj(x) || !isNum(x.lon) || !isNum(x.lat) || Math.abs(x.lat) > 90 || Math.abs(x.lon) > 360) return null;
  const name = optStr(x.name, 120);
  const placeId = optStr(x.placeId, 120);
  return { lon: x.lon, lat: x.lat, ...(name ? { name } : {}), ...(placeId ? { placeId } : {}) };
}

function task(x: unknown): Task | null {
  if (!isObj(x) || typeof x.id !== 'string' || !ID.test(x.id) || !KINDS.includes(x.kind as TaskKind) || !isNum(x.minutes) || x.minutes < 0 || x.minutes > 24 * 60) return null;
  const label = optStr(x.label, 120);
  return { id: x.id, kind: x.kind as TaskKind, minutes: x.minutes, ...(label ? { label } : {}) };
}

function stop(x: unknown): Stop | null {
  const at = waypoint(x);
  if (!at || !isObj(x) || typeof x.id !== 'string' || !ID.test(x.id) || !Array.isArray(x.tasks) || x.tasks.length > MAX_TASKS) return null;
  const tasks = x.tasks.map(task);
  if (tasks.some((t) => t === null)) return null;
  return { ...at, id: x.id, tasks: tasks as Task[] };
}

/** A shared plan if the text holds a well-formed one, else null. */
export function parsePlan(json: string): SharedPlan | null {
  let x: unknown;
  try {
    x = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(x) || x.v !== 1 || !isObj(x.plan)) return null;
  const p = x.plan;
  const start = p.start === null ? null : waypoint(p.start);
  if (p.start !== null && !start) return null;
  if (!Array.isArray(p.stops) || p.stops.length > MAX_STOPS) return null;
  const stops = p.stops.map(stop);
  if (stops.some((s) => s === null)) return null;
  if (typeof p.vehicle !== 'string' || !(p.vehicle in VEHICLES) || !STYLES.includes(p.style as RouteStyle)) return null;
  if (typeof p.roundTrip !== 'boolean' || typeof p.campAtNight !== 'boolean') return null;
  const plan: MissionPlan = { start, stops: stops as Stop[], roundTrip: p.roundTrip, vehicle: p.vehicle as MissionPlan['vehicle'], style: p.style as RouteStyle, campAtNight: p.campAtNight };
  return { plan, templateId: typeof x.templateId === 'string' && x.templateId.length <= 64 ? x.templateId : null };
}

/** JSON with keys in a fixed order, so two copies of a plan compare equal however they were built. */
function stable(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, e]) => e !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

/** Two plans that would route the same. Cheap enough to run on every store change. */
export function samePlan(a: MissionPlan, b: MissionPlan): boolean {
  return a === b || stable(a) === stable(b);
}
