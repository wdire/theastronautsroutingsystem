import type { MissionPlan, RouteStyle, Stop, Task, TaskKind, VehicleId, Waypoint } from '@/engines/types';

/** The part of the app state that lives in the URL hash, so a link reopens the same plan and view. */
export interface UrlState {
  camera?: { lon: number; lat: number; zoom: number; bearing: number; pitch: number };
  plan?: Pick<MissionPlan, 'start' | 'stops' | 'roundTrip' | 'vehicle' | 'style' | 'campAtNight'>;
  /** A departure time chosen by hand; absent means "now". */
  departUtcMs?: number;
  /** The place whose card is open. */
  place?: string;
}

const VEHICLES: readonly VehicleId[] = ['foot', 'openRover', 'pressRover', 'robotRover', 'heli'];
const STYLES: readonly RouteStyle[] = ['safest', 'fastest', 'eco'];
const TASK_CODE: Record<TaskKind, string> = { sample: 's', photo: 'p', measure: 'm', survey: 'v', custom: 'c' };
const CODE_TASK = Object.fromEntries(Object.entries(TASK_CODE).map(([k, v]) => [v, k])) as Record<string, TaskKind>;

const MAX_STOPS = 24;
const MAX_TASKS = 12;

function num(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

function finite(s: string | undefined, lo: number, hi: number): number | null {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** Names travel in the hash, so keep them short and free of the separators used below. */
function safeName(name: string): string {
  return name.replace(/[~|;,@&=#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
}

function encodeWaypoint(w: Waypoint): string {
  const base = `${num(w.lon, 5)},${num(w.lat, 5)}`;
  if (w.placeId) return `${base}@${encodeURIComponent(w.placeId)}`;
  return w.name ? `${base};${encodeURIComponent(safeName(w.name))}` : base;
}

function decodeWaypoint(text: string): Waypoint | null {
  const m = /^(-?[\d.]+),(-?[\d.]+)(?:@([^;~]*))?(?:;([^~]*))?$/.exec(text);
  if (!m) return null;
  const lon = finite(m[1], -180, 360);
  const lat = finite(m[2], -90, 90);
  if (lon === null || lat === null) return null;
  const w: Waypoint = { lon, lat };
  try {
    if (m[3]) w.placeId = decodeURIComponent(m[3]).slice(0, 64);
    if (m[4]) w.name = safeName(decodeURIComponent(m[4]));
  } catch {
    // A broken escape only loses the name.
  }
  return w;
}

function encodeTask(t: Task): string {
  const label = t.label ? `:${encodeURIComponent(safeName(t.label))}` : '';
  return `${TASK_CODE[t.kind]}${Math.round(t.minutes)}${label}`;
}

function decodeTask(text: string, id: string): Task | null {
  const m = /^([spmvc])(\d{1,4})(?::(.*))?$/.exec(text);
  if (!m) return null;
  const kind = CODE_TASK[m[1] ?? ''];
  const minutes = finite(m[2], 1, 1440);
  if (!kind || minutes === null) return null;
  const task: Task = { id, kind, minutes };
  if (m[3]) {
    try {
      task.label = safeName(decodeURIComponent(m[3]));
    } catch {
      // Keep the task without its label.
    }
  }
  return task;
}

export function encodeUrlState(state: UrlState): string {
  const parts: string[] = [];
  const c = state.camera;
  if (c) parts.push(`c=${num(c.lon, 4)},${num(c.lat, 4)},${num(c.zoom, 2)},${num(c.bearing, 0)},${num(c.pitch, 0)}`);
  const p = state.plan;
  if (p) {
    if (p.start) parts.push(`from=${encodeWaypoint(p.start)}`);
    if (p.stops.length) {
      parts.push(
        `stops=${p.stops
          .slice(0, MAX_STOPS)
          .map((s) => [encodeWaypoint(s), ...s.tasks.slice(0, MAX_TASKS).map(encodeTask)].join('~'))
          .join('|')}`,
      );
    }
    if (p.vehicle !== 'foot') parts.push(`veh=${p.vehicle}`);
    if (p.style !== 'safest') parts.push(`style=${p.style}`);
    if (p.roundTrip) parts.push('rt=1');
    if (p.campAtNight) parts.push('camp=1');
  }
  if (state.departUtcMs !== undefined) parts.push(`t=${Math.round(state.departUtcMs / 1000)}`);
  if (state.place) parts.push(`place=${encodeURIComponent(state.place)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

/** Reads a hash. Anything it does not understand is dropped; it never throws. */
export function decodeUrlState(hash: string): UrlState {
  const out: UrlState = {};
  const text = hash.replace(/^#/, '');
  if (!text) return out;
  const kv = new Map<string, string>();
  for (const part of text.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1));
  }

  const c = kv.get('c')?.split(',');
  if (c && c.length >= 3) {
    const lon = finite(c[0], -180, 360);
    const lat = finite(c[1], -85, 85);
    const zoom = finite(c[2], 0, 17);
    if (lon !== null && lat !== null && zoom !== null) {
      out.camera = { lon, lat, zoom, bearing: finite(c[3], -360, 360) ?? 0, pitch: finite(c[4], 0, 80) ?? 0 };
    }
  }

  const start = kv.has('from') ? decodeWaypoint(kv.get('from') ?? '') : null;
  const stops: Stop[] = [];
  for (const [i, chunk] of (kv.get('stops') ?? '').split('|').slice(0, MAX_STOPS).entries()) {
    if (!chunk) continue;
    const [head, ...taskTexts] = chunk.split('~');
    const w = decodeWaypoint(head ?? '');
    if (!w) continue;
    const tasks = taskTexts
      .slice(0, MAX_TASKS)
      .map((t, j) => decodeTask(t, `s${i}t${j}`))
      .filter((t): t is Task => t !== null);
    stops.push({ ...w, id: `s${i}`, tasks });
  }
  const vehicle = VEHICLES.find((v) => v === kv.get('veh'));
  const style = STYLES.find((s) => s === kv.get('style'));
  if (start || stops.length || vehicle || style || kv.has('rt') || kv.has('camp')) {
    out.plan = {
      start,
      stops,
      vehicle: vehicle ?? 'foot',
      style: style ?? 'safest',
      roundTrip: kv.get('rt') === '1',
      campAtNight: kv.get('camp') === '1',
    };
  }

  const t = finite(kv.get('t'), 0, 4_102_444_800);
  if (t !== null) out.departUtcMs = t * 1000;

  const place = kv.get('place');
  if (place) {
    try {
      out.place = decodeURIComponent(place).slice(0, 64);
    } catch {
      // Ignore a broken escape.
    }
  }
  return out;
}

/** StrictMode runs effects twice in development; the hash must be applied once per page load. */
let applied = false;

export function takeInitialUrlState(hash: string): UrlState | null {
  if (applied) return null;
  applied = true;
  return decodeUrlState(hash);
}

/** For tests only. */
export function resetUrlApplied(): void {
  applied = false;
}
