/**
 * The debrief: what was planned, what happened, who did what. The commander's browser writes it once when the
 * run ends, from the world it ran; everyone reads the same record afterwards. It is stored as opaque JSON, so
 * reading it back checks every field it uses.
 */
import type { Alert, Severity, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import type { OutcomeKind, World } from '@/sim/types';
import { fmtDistance, fmtDuration, fmtNumber } from '@/lib/format';
import { SEVERITY_WORD } from './words';
import type { Planned } from './snapshot';

export interface DebriefCrew {
  name: string;
  role: string;
  android: boolean;
  color: string;
  /** Left during the run. */
  left: boolean;
}

export interface DebriefTask {
  id: string;
  stopName: string;
  label: string;
  minutes: number;
  state: 'todo' | 'doing' | 'done' | 'skipped';
  assignee: string | null;
}

export interface DebriefAlert {
  atUtcMs: number;
  severity: Severity;
  title: string;
  resolved: 'applied' | 'ignored' | 'expired' | null;
  action: string | null;
}

export interface DebriefLine {
  atUtcMs: number | null;
  author: string;
  kind: 'note' | 'radio' | 'system' | 'task';
  text: string;
  taskId: string | null;
}

export interface Debrief {
  v: 1;
  title: string;
  objective: string;
  vehicle: VehicleId;
  siteName: string | null;
  crew: DebriefCrew[];
  /** The departure the commander set, if any, and when the run actually set out (both mission time). */
  plannedStartUtc: number | null;
  startedUtcMs: number | null;
  endedUtcMs: number | null;
  /** Where the mission began, for local solar time. */
  lon: number;
  planned: Planned | null;
  actual: {
    kind: OutcomeKind;
    text: string;
    durationS: number;
    distM: number;
    o2Frac: number | null;
    batteryFrac: number | null;
    doseMSv: number;
    tasksDone: number;
    tasksTotal: number;
  } | null;
  tasks: DebriefTask[];
  alerts: DebriefAlert[];
  routeChanges: number;
  log: DebriefLine[];
  /** What the base and the instruments said over the radio, from the simulation. */
  messages: { atUtcMs: number; from: 'crew' | 'base' | 'system'; text: string }[];
}

export interface DebriefInput {
  mission: { title: string; objective: string; vehicle: string; siteName: string | null; plannedStartUtc: number | null };
  crew: { _id: string; kind: 'human' | 'android'; name: string; role: string; color: string; state: 'invited' | 'joined' | 'left' }[];
  assignments: Record<string, string>;
  world: World | null;
  planned: Planned | null;
  log: { authorName: string; kind: DebriefLine['kind']; text: string; missionUtcMs: number | null; taskId?: string | null }[];
  colorOf: (color: string) => string;
  /** Lon of the plan's start, when there is no run to read it from. */
  fallbackLon: number;
}

// Keeps the record well under the server's limit even for a long run with a chatty crew.
const MAX_LINES = 200;
const MAX_MESSAGES = 200;

/** A plan task id from a run task id ("stopId:taskId"). Assignments are keyed by the plan's task id. */
export function planTaskId(runTaskId: string): string {
  const i = runTaskId.lastIndexOf(':');
  return i >= 0 ? runTaskId.slice(i + 1) : runTaskId;
}

/** The crew log line written when an alert fires; the timeline matches it to leave the alert out once. */
export function alertLine(alert: Pick<Alert, 'severity' | 'title'>): string {
  return `${SEVERITY_WORD[alert.severity]}: ${alert.title}`;
}

export function buildDebrief(input: DebriefInput): Debrief {
  const { mission, world } = input;
  const run = world?.run ?? null;
  const vehicle = (run?.vehicle ?? mission.vehicle) as VehicleId;
  const nameOf = new Map(input.crew.map((c) => [c._id, c.name]));
  const out = run?.outcome;
  return {
    v: 1,
    title: mission.title,
    objective: mission.objective,
    vehicle: vehicle in VEHICLES ? vehicle : 'foot',
    siteName: mission.siteName,
    crew: input.crew.filter((c) => c.state !== 'invited').map((c) => ({ name: c.name, role: c.role, android: c.kind === 'android', color: input.colorOf(c.color), left: c.state === 'left' })),
    plannedStartUtc: mission.plannedStartUtc,
    startedUtcMs: run?.startedUtcMs ?? null,
    endedUtcMs: run?.endedUtcMs ?? out?.atUtcMs ?? world?.utcMs ?? null,
    lon: run?.home[0] ?? input.fallbackLon,
    planned: input.planned,
    actual: out
      ? { kind: out.kind, text: out.text, durationS: out.durationS, distM: out.distM, o2Frac: out.o2Frac, batteryFrac: out.batteryFrac, doseMSv: out.doseMSv, tasksDone: out.tasksDone, tasksTotal: out.tasksTotal }
      : null,
    tasks: (run?.tasks ?? []).map((t) => {
      const crewId = input.assignments[planTaskId(t.id)];
      return { id: t.id, stopName: t.stopName, label: t.label, minutes: t.minutes, state: t.state, assignee: crewId ? (nameOf.get(crewId) ?? null) : null };
    }),
    alerts: (world?.alerts ?? []).map((a) => ({ atUtcMs: a.atUtcMs, severity: a.severity, title: a.title, resolved: a.resolved ?? null, action: a.action?.label ?? null })),
    routeChanges: run?.leg ?? 0,
    log: input.log.slice(-MAX_LINES).map((l) => ({ atUtcMs: l.missionUtcMs, author: l.authorName, kind: l.kind, text: l.text, taskId: l.taskId ?? null })),
    messages: (world?.messages ?? []).slice(-MAX_MESSAGES).map((m) => ({ atUtcMs: m.atUtcMs, from: m.from, text: m.text })),
  };
}

const SEVERITIES: readonly Severity[] = ['note', 'advisory', 'caution', 'warning'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length <= 4000;
const isStrOrNull = (x: unknown): x is string | null => x === null || isStr(x);

/** A debrief if the text is one this version can show, else null. Malformed list entries are dropped, not fatal. */
export function parseDebrief(json: string | null): Debrief | null {
  if (!json) return null;
  let x: unknown;
  try {
    x = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(x) || x.v !== 1 || !isStr(x.title) || !isStr(x.objective) || typeof x.vehicle !== 'string' || !(x.vehicle in VEHICLES)) return null;
  if (!isNumOrNull(x.plannedStartUtc) || !isNumOrNull(x.startedUtcMs) || !isNumOrNull(x.endedUtcMs) || !isNum(x.lon) || !isNum(x.routeChanges)) return null;
  const list = <T>(v: unknown, ok: (e: Record<string, unknown>) => boolean): T[] => (Array.isArray(v) ? (v.filter((e) => isObj(e) && ok(e)) as T[]) : []);
  const planned = isObj(x.planned) && isNum(x.planned.durationS) && isNum(x.planned.distM) && isNum(x.planned.doseMSv) && isNum(x.planned.departUtcMs) && isNumOrNull(x.planned.o2EndFrac) && isNumOrNull(x.planned.batteryEndFrac) ? (x.planned as unknown as Planned) : null;
  const a = x.actual;
  const actual =
    isObj(a) && isStr(a.kind) && isStr(a.text) && isNum(a.durationS) && isNum(a.distM) && isNumOrNull(a.o2Frac) && isNumOrNull(a.batteryFrac) && isNum(a.doseMSv) && isNum(a.tasksDone) && isNum(a.tasksTotal)
      ? (a as unknown as Debrief['actual'])
      : null;
  return {
    v: 1,
    title: x.title,
    objective: x.objective,
    vehicle: x.vehicle as VehicleId,
    siteName: isStr(x.siteName) ? x.siteName : null,
    crew: list<DebriefCrew>(x.crew, (c) => isStr(c.name) && isStr(c.role) && typeof c.android === 'boolean' && isStr(c.color) && typeof c.left === 'boolean'),
    plannedStartUtc: x.plannedStartUtc,
    startedUtcMs: x.startedUtcMs,
    endedUtcMs: x.endedUtcMs,
    lon: x.lon,
    planned,
    actual,
    tasks: list<DebriefTask>(x.tasks, (t) => isStr(t.id) && isStr(t.stopName) && isStr(t.label) && isNum(t.minutes) && ['todo', 'doing', 'done', 'skipped'].includes(t.state as string) && isStrOrNull(t.assignee)),
    alerts: list<DebriefAlert>(x.alerts, (e) => isNum(e.atUtcMs) && SEVERITIES.includes(e.severity as Severity) && isStr(e.title) && isStrOrNull(e.resolved) && isStrOrNull(e.action)),
    routeChanges: x.routeChanges,
    log: list<DebriefLine>(x.log, (l) => isNumOrNull(l.atUtcMs) && isStr(l.author) && ['note', 'radio', 'system', 'task'].includes(l.kind as string) && isStr(l.text) && isStrOrNull(l.taskId)),
    messages: list<Debrief['messages'][number]>(x.messages, (m) => isNum(m.atUtcMs) && ['crew', 'base', 'system'].includes(m.from as string) && isStr(m.text)),
  };
}

/* ---------- reading it ---------- */

/** "+38 min", "−1.2 km", "the same": how far the actual figure is from the planned one, in plain units. */
export function fmtDelta(kind: 'duration' | 'distance' | 'fraction' | 'dose', planned: number | null, actual: number | null): string {
  if (planned === null || actual === null) return '';
  const d = actual - planned;
  const sign = d > 0 ? '+' : '−';
  switch (kind) {
    case 'duration':
      return Math.abs(d) < 60 ? 'as planned' : `${sign}${fmtDuration(Math.abs(d))}`;
    case 'distance':
      return Math.abs(d) < 5 ? 'as planned' : `${sign}${fmtDistance(Math.abs(d))}`;
    case 'fraction': {
      const points = Math.round(Math.abs(d) * 100);
      return points === 0 ? 'as planned' : `${sign}${points} ${points === 1 ? 'point' : 'points'}`;
    }
    case 'dose':
      return Math.abs(d) < 0.005 ? 'as planned' : `${sign}${fmtNumber(Math.abs(d), 2)} mSv`;
  }
}

export interface TimelineEvent {
  atUtcMs: number;
  kind: 'start' | 'alert' | 'route' | 'task' | 'radio' | 'note' | 'system' | 'end' | 'private';
  text: string;
  who?: string;
  severity?: Severity;
}

const RESOLVED: Record<NonNullable<DebriefAlert['resolved']>, string> = { applied: 'acted on', ignored: 'ignored', expired: 'passed' };

/** How an alert ended, in words for the timeline. */
export function resolution(a: DebriefAlert): string {
  if (!a.resolved) return 'still open at the end';
  if (a.resolved === 'applied' && a.action) return `acted on: ${a.action}`;
  return RESOLVED[a.resolved];
}

/**
 * Everything that happened, in mission time: the start, alerts, route changes and task updates from the log,
 * crew calls, the reader's own notes, and the end. Alert lines in the log are left out; the alert list has them
 * with how they were resolved.
 */
export function timelineOf(d: Debrief, privateNotes: { text: string; missionUtcMs: number | null }[] = []): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  // The start and the end have lines of their own in the log; they are shown once, as the start and the end.
  const setOut = d.log.find((l) => l.kind === 'system' && l.text.startsWith('Set out'));
  const over = d.actual ? `Mission over. ${d.actual.text}` : null;
  if (d.startedUtcMs !== null) events.push({ atUtcMs: d.startedUtcMs, kind: 'start', text: setOut?.text ?? 'Set out.' });
  for (const a of d.alerts) events.push({ atUtcMs: a.atUtcMs, kind: 'alert', text: `${a.title} (${resolution(a)})`, severity: a.severity });
  const alertLines = new Set(d.alerts.map(alertLine));
  for (const l of d.log) {
    if (l.atUtcMs === null || l === setOut) continue;
    if (l.kind === 'system') {
      if (alertLines.has(l.text) || l.text === over) continue;
      events.push({ atUtcMs: l.atUtcMs, kind: l.taskId ? 'task' : /^route changed/i.test(l.text) ? 'route' : 'system', text: l.text });
    } else {
      events.push({ atUtcMs: l.atUtcMs, kind: l.kind === 'radio' ? 'radio' : l.kind === 'task' ? 'task' : 'note', text: l.text, who: l.author });
    }
  }
  for (const n of privateNotes) if (n.missionUtcMs !== null) events.push({ atUtcMs: n.missionUtcMs, kind: 'private', text: n.text, who: 'You' });
  if (d.endedUtcMs !== null && d.actual) events.push({ atUtcMs: d.endedUtcMs, kind: 'end', text: d.actual.text });
  // Stable: events at the same moment keep the order they were added in (start first, end last).
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.atUtcMs - b.e.atUtcMs || a.i - b.i).map(({ e }) => e);
}

/** Tasks grouped by the stop they belong to, in plan order. */
export function tasksByStop(tasks: DebriefTask[]): { stopName: string; tasks: DebriefTask[] }[] {
  const groups: { stopName: string; tasks: DebriefTask[] }[] = [];
  for (const t of tasks) {
    const last = groups[groups.length - 1];
    if (last && last.stopName === t.stopName) last.tasks.push(t);
    else groups.push({ stopName: t.stopName, tasks: [t] });
  }
  return groups;
}

/** One sentence for the header. */
export function outcomeSentence(d: Debrief): string {
  if (!d.actual) return 'The mission was cancelled before it set out.';
  return d.actual.text;
}
