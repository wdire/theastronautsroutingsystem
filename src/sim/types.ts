/**
 * The simulated world as plain, serialisable data. Everything here survives structuredClone, so the owner tab
 * can post the whole world to mirror tabs over a BroadcastChannel and a test can compare worlds with toEqual.
 * Times are UTC milliseconds since the Unix epoch; durations inside a leg are seconds since the leg began.
 */
import type {
  Alert,
  HazardZone,
  LonLat,
  MissionPlan,
  PathPoint,
  Scenario,
  TripResult,
  VehicleId,
} from '@/engines/types';

/** Simulated seconds per real second. */
export type Speed = 1 | 5 | 20 | 100;
export const SPEEDS: readonly Speed[] = [1, 5, 20, 100];

export interface Message {
  id: string;
  from: 'crew' | 'base' | 'system';
  text: string;
  atUtcMs: number;
}

/** A crew line waiting for the base to answer. */
export interface PendingReply {
  id: string;
  dueUtcMs: number;
  question: string;
}

export interface RunTask {
  id: string;
  stopId: string;
  stopName: string;
  label: string;
  minutes: number;
  state: 'todo' | 'doing' | 'done' | 'skipped';
}

/**
 * What earlier legs already used, so a mission that changed route reports one continuous story.
 * Oxygen and battery are amounts spent, relative to what the vehicle carried at mission start.
 */
export interface Carry {
  o2Kg: number;
  batteryKWh: number;
  doseMSv: number;
  waterL: number;
  distM: number;
  timeS: number;
}

/** A stop still served by the current path, and where on the path it is. */
export interface LegStop {
  stopId: string;
  index: number;
}

export type OutcomeKind = 'home' | 'arrived' | 'aborted' | 'stranded';

export interface MissionOutcome {
  kind: OutcomeKind;
  atUtcMs: number;
  /** One or two plain sentences for the end card. */
  text: string;
  tasksDone: number;
  tasksTotal: number;
  distM: number;
  durationS: number;
  o2Frac: number | null;
  batteryFrac: number | null;
  doseMSv: number;
}

export interface MissionRun {
  id: string;
  name: string;
  plan: MissionPlan;
  vehicle: VehicleId;
  scenario: Scenario;
  /** The current leg's path: the planned route, or the route adopted after the last change. */
  path: PathPoint[];
  stopIndices: number[];
  trip: TripResult;
  startedUtcMs: number;
  legStartUtcMs: number;
  /** How many route changes the mission has had. */
  leg: number;
  carry: Carry;
  /** Oxygen and battery carried at mission start; fractions are of these. */
  startLevels: { o2Kg: number | null; batteryKWh: number | null };
  tasks: RunTask[];
  legStops: LegStop[];
  /** Where the mission began; a turn back routes here. */
  home: LonLat;
  /** The end of the current path is home (a round trip, or after turning back). */
  homeIsAhead: boolean;
  status: 'running' | 'done' | 'aborted';
  /** When the mission finished or was aborted; the crew stays where they were then. */
  endedUtcMs?: number;
  outcome?: MissionOutcome;
}

export type EventKind = 'dustDevil' | 'storm' | 'solar';

/** An event waiting for its moment. Its alert is written when it fires, from the crew's state then. */
export interface ScheduledEvent {
  id: string;
  kind: EventKind;
  atUtcMs: number;
  lon?: number;
  lat?: number;
  radiusM?: number;
}

export interface World {
  utcMs: number;
  speed: Speed;
  paused: boolean;
  run: MissionRun | null;
  alerts: Alert[];
  hazards: HazardZone[];
  messages: Message[];
  pendingReplies: PendingReply[];
  scheduled: ScheduledEvent[];
  /** Mulberry32 state; every random choice draws from it so a seed replays the same mission. */
  rng: number;
  /** Alert ids already raised in this mission, so each fires once. */
  firedIds: string[];
  /** Counter for message, reply and run ids. */
  seq: number;
}

/** What the caller needs to ask the router for a changed route. */
export interface RouteProposal {
  alertId: string;
  action: 'reroute' | 'turnBack';
  from: LonLat;
  /** Waypoints to pass in order; the last is the end of the new route. */
  via: { lon: number; lat: number; name?: string; stopId?: string }[];
  hazards: HazardZone[];
  vehicle: VehicleId;
  /** The new route starts now. */
  departUtcMs: number;
  homeIsAhead: boolean;
}

export interface NewRoute {
  path: PathPoint[];
  /** Path index of the start and of each waypoint in `via`, in order. */
  stopIndices: number[];
  trip: TripResult;
}

export interface Progress {
  /** Share of the mission's time behind the crew, 0 to 1. */
  fraction: number;
  nextName: string;
  nextDistM: number;
  nextS: number;
  tasksDone: number;
  tasksTotal: number;
}
