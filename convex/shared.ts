/**
 * Constants the server and the client agree on. It imports nothing, so the app can pull it in
 * (`import { SUIT_COLORS } from '../convex/shared'`) without dragging server code into the bundle.
 */

/** The bands painted on a person's suit. A person picks one; androids always wear graphite. */
export const SUIT_COLORS = ['signal', 'flare', 'ochre', 'lichen', 'glacier', 'cobalt', 'iris', 'chalk'] as const;
export type SuitColor = (typeof SUIT_COLORS)[number];

export const ANDROID_COLOR = 'graphite';
export type CrewColor = SuitColor | typeof ANDROID_COLOR;

export const SUIT_COLOR_HEX: Record<CrewColor, string> = {
  signal: '#ff6a1f',
  flare: '#e5383b',
  ochre: '#f2b632',
  lichen: '#7fb069',
  glacier: '#4fc3c7',
  cobalt: '#3a6ff7',
  iris: '#9b6dff',
  chalk: '#e9e6df',
  graphite: '#5c6166',
};

export const COMMANDER_ROLE = 'Commander';
export const DEFAULT_ROLE = 'Field Geologist';
/** Offered in the role picker; any other 1 to 40 character role is also accepted. */
export const ROLE_PRESETS = [COMMANDER_ROLE, 'Crew Engineer', DEFAULT_ROLE, 'Health & Safety Officer', 'Science Officer', 'Navigator'] as const;

/** Androids that are not given a name take the first free callsign, in this order. */
export const ANDROID_CALLSIGNS = [
  'AND-2 Basalt',
  'AND-4 Olivine',
  'AND-7 Regolith',
  'AND-9 Jarosite',
  'AND-3 Hematite',
  'AND-5 Gypsum',
  'AND-6 Perchlorate',
  'AND-8 Pyroxene',
  'AND-11 Feldspar',
  'AND-12 Serpentine',
  'AND-10 Carbonate',
  'AND-1 Bedrock',
] as const;

/** Humans, androids and open invites together. */
export const MAX_CREW = 8;

const KB = 1024;

/** Lengths count characters after trimming; JSON sizes count UTF-8 bytes. */
export const LIMITS = {
  name: 32,
  title: 60,
  objective: 280,
  role: 40,
  vehicle: 60,
  siteName: 80,
  logText: 1000,
  noteText: 4000,
  planBytes: 200 * KB,
  snapshotBytes: 200 * KB,
  routeBytes: 800 * KB,
  debriefBytes: 600 * KB,
} as const;

/** How often the client should heartbeat, and when the server gives up on a silent browser. */
export const HEARTBEAT_MS = 10_000;
export const STALE_MS = 40_000;

/** The mapped region, [west, south, east, north] degrees: the base must stand inside it (mirrors src/lib/constants REGION). */
export const BASE_REGION = [71.8, 13.1, 83.1, 23.8] as const;

/** A task's assignee: the whole crew, or one or more crew rows (by id). Older missions store a single id. */
export const EVERYONE = 'all' as const;
/** 'all', or crew ids. A lone id (a string) only on missions from before multi-assign. */
export type Assignee = string | string[];

/** Who a stored assignee names: everyone, or a list of crew ids (empty when nobody). */
export function assigneeIds(value: Assignee | undefined | null): { everyone: boolean; ids: string[] } {
  if (value === undefined || value === null) return { everyone: false, ids: [] };
  if (value === EVERYONE) return { everyone: true, ids: [] };
  return { everyone: false, ids: Array.isArray(value) ? value : [value] };
}

/** An assignee with one crew row taken off it; undefined when nobody is left on the task. */
export function withoutCrew(value: Assignee, crewId: string): Assignee | undefined {
  if (value === EVERYONE) return value;
  const ids = assigneeIds(value).ids.filter((id) => id !== crewId);
  return ids.length > 0 ? ids : undefined;
}

/** The assignments with one crew row taken off every task; null when nothing changed. */
export function dropCrewFrom<A extends Assignee>(assignments: Record<string, A>, crewId: string): Record<string, A> | null {
  let changed = false;
  const kept: Record<string, A> = {};
  for (const [task, value] of Object.entries(assignments)) {
    const next = withoutCrew(value, crewId) as A | undefined;
    if (next !== value) changed = true;
    if (next !== undefined) kept[task] = next;
  }
  return changed ? kept : null;
}

/** The assignee in words: "Everyone", "Ana", "Ana and Bo", "Ana, Bo and Cy". Null when nobody. */
export function assigneeWords(value: Assignee | undefined | null, nameOf: (crewId: string) => string | undefined): string | null {
  const { everyone, ids } = assigneeIds(value);
  if (everyone) return 'Everyone';
  const names = ids.map(nameOf).filter((n): n is string => !!n);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
