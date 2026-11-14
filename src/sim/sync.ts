/**
 * Keeps an owner tab and mirror tabs in step over a BroadcastChannel. The owner runs the world and posts
 * snapshots; mirrors show them and send commands back. Anything on the channel may come from another page
 * or an older build, so every message is checked before it is used and anything malformed is dropped.
 */
import type { Severity } from '@/engines/types';
import { SPEEDS } from './types';
import type { Speed, World } from './types';

/** The part of a BroadcastChannel this needs, so tests can pass a fake. */
export interface SyncChannel {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export type SyncCommand =
  | { type: 'say'; text: string }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'apply'; alertId: string }
  | { type: 'ignore'; alertId: string };

export type SyncMessage = { kind: 'snapshot'; world: World } | { kind: 'command'; command: SyncCommand } | { kind: 'hello' };

export interface SyncHandlers {
  /** Mirrors: a fresh world from the owner. */
  onSnapshot?: (world: World) => void;
  /** Owner: a command from a mirror. */
  onCommand?: (command: SyncCommand) => void;
  /** Owner: a mirror just opened and wants a snapshot. */
  onHello?: () => void;
}

export interface Sync {
  role: 'owner' | 'mirror';
  /** Owner: post a snapshot unless one went out less than 250 ms ago (or `force`). True if it was sent. */
  publish(world: World, nowMs: number, force?: boolean): boolean;
  /** Mirror: send a command to the owner. False if the command is malformed or this is the owner. */
  send(command: SyncCommand): boolean;
  close(): void;
}

/** At most four snapshots a second. */
export const SNAPSHOT_INTERVAL_MS = 250;
const MAX_TEXT = 500;
const MAX_ID = 200;
const SEVERITIES: readonly Severity[] = ['note', 'advisory', 'caution', 'warning'];
const FROM = ['crew', 'base', 'system'];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isStr(x: unknown, max = MAX_TEXT): x is string {
  return typeof x === 'string' && x.length <= max;
}

function isSpeed(x: unknown): x is Speed {
  return SPEEDS.includes(x as Speed);
}

function isPoint(x: unknown): boolean {
  return Array.isArray(x) && x.length >= 2 && x.every(isNum);
}

function isRun(x: unknown): boolean {
  if (x === null) return true;
  if (!isObj(x)) return false;
  const trip = x.trip;
  return (
    isStr(x.id, MAX_ID) &&
    isStr(x.name) &&
    isStr(x.vehicle, 32) &&
    isObj(x.plan) &&
    isObj(x.scenario) &&
    Array.isArray(x.path) &&
    x.path.length > 0 &&
    x.path.every(isPoint) &&
    Array.isArray(x.stopIndices) &&
    x.stopIndices.every(isNum) &&
    isObj(trip) &&
    Array.isArray(trip.samples) &&
    trip.samples.every((s) => isObj(s) && isNum(s.tS) && isNum(s.distM)) &&
    isObj(trip.totals) &&
    isNum(x.startedUtcMs) &&
    isNum(x.legStartUtcMs) &&
    isNum(x.leg) &&
    isObj(x.carry) &&
    ['o2Kg', 'batteryKWh', 'doseMSv', 'waterL', 'distM', 'timeS'].every((k) => isNum((x.carry as Record<string, unknown>)[k])) &&
    isObj(x.startLevels) &&
    Array.isArray(x.tasks) &&
    x.tasks.every((t) => isObj(t) && isStr(t.id, MAX_ID) && isStr(t.stopId, MAX_ID) && isStr(t.label) && isNum(t.minutes) && ['todo', 'doing', 'done', 'skipped'].includes(t.state as string)) &&
    Array.isArray(x.legStops) &&
    x.legStops.every((l) => isObj(l) && isStr(l.stopId, MAX_ID) && isNum(l.index)) &&
    isPoint(x.home) &&
    typeof x.homeIsAhead === 'boolean' &&
    ['running', 'done', 'aborted'].includes(x.status as string)
  );
}

/** A structural check of a world snapshot: enough that the UI and crewAt can use it without throwing. */
export function isWorld(x: unknown): x is World {
  if (!isObj(x)) return false;
  return (
    isNum(x.utcMs) &&
    isSpeed(x.speed) &&
    typeof x.paused === 'boolean' &&
    isRun(x.run) &&
    Array.isArray(x.alerts) &&
    x.alerts.every(
      (a) => isObj(a) && isStr(a.id, MAX_ID) && SEVERITIES.includes(a.severity as Severity) && isStr(a.title) && isStr(a.body, 2000) && isNum(a.atUtcMs),
    ) &&
    Array.isArray(x.hazards) &&
    x.hazards.every((h) => isObj(h) && isStr(h.id, MAX_ID) && isNum(h.lon) && isNum(h.lat) && isNum(h.radiusM)) &&
    Array.isArray(x.messages) &&
    x.messages.every((m) => isObj(m) && isStr(m.id, MAX_ID) && FROM.includes(m.from as string) && isStr(m.text, 2000) && isNum(m.atUtcMs)) &&
    Array.isArray(x.pendingReplies) &&
    Array.isArray(x.scheduled) &&
    isNum(x.rng) &&
    Array.isArray(x.firedIds) &&
    isNum(x.seq)
  );
}

/** A command if the value is a well-formed one, else null. Copies only the known fields. */
export function parseCommand(x: unknown): SyncCommand | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'say':
      return isStr(x.text) && x.text.trim() ? { type: 'say', text: x.text } : null;
    case 'setSpeed':
      return isSpeed(x.speed) ? { type: 'setSpeed', speed: x.speed } : null;
    case 'setPaused':
      return typeof x.paused === 'boolean' ? { type: 'setPaused', paused: x.paused } : null;
    case 'apply':
    case 'ignore':
      return isStr(x.alertId, MAX_ID) && x.alertId ? { type: x.type, alertId: x.alertId } : null;
    default:
      return null;
  }
}

export function createSync(channel: SyncChannel, role: 'owner' | 'mirror', handlers: SyncHandlers): Sync {
  let lastSent = -Infinity;
  let closed = false;
  const postSafe = (m: SyncMessage): boolean => {
    if (closed) return false;
    try {
      channel.postMessage(m);
      return true;
    } catch {
      // A world that cannot be cloned, or a closed channel: the next publish tries again.
      return false;
    }
  };
  channel.onmessage = (event) => {
    const data = isObj(event) ? event.data : undefined;
    if (closed || !isObj(data)) return;
    if (role === 'mirror' && data.kind === 'snapshot') {
      if (isWorld(data.world)) handlers.onSnapshot?.(data.world);
    } else if (role === 'owner' && data.kind === 'command') {
      const cmd = parseCommand(data.command);
      if (cmd) handlers.onCommand?.(cmd);
    } else if (role === 'owner' && data.kind === 'hello') {
      lastSent = -Infinity;
      handlers.onHello?.();
    }
  };
  if (role === 'mirror') postSafe({ kind: 'hello' });
  return {
    role,
    publish(world, nowMs, force = false) {
      if (role !== 'owner' || !Number.isFinite(nowMs)) return false;
      if (!force && nowMs - lastSent < SNAPSHOT_INTERVAL_MS) return false;
      if (!postSafe({ kind: 'snapshot', world })) return false;
      lastSent = nowMs;
      return true;
    },
    send(command) {
      if (role !== 'mirror') return false;
      const cmd = parseCommand(command);
      return cmd ? postSafe({ kind: 'command', command: cmd }) : false;
    },
    close() {
      closed = true;
      channel.onmessage = null;
      channel.close();
    },
  };
}
