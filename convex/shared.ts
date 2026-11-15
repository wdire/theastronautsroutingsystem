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
