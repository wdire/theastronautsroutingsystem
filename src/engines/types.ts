/**
 * Shared types for engines, simulation, map and UI. This file is the contract between them:
 * a module that needs a new shared shape adds it here rather than redefining it locally.
 * Longitudes are east-positive degrees, latitudes planetocentric degrees, elevations metres
 * above the MOLA areoid, times milliseconds since the Unix epoch (UTC) unless a name says otherwise.
 */

export type LonLat = readonly [lon: number, lat: number];
export type PathPoint = readonly [lon: number, lat: number, elev: number];

export type VehicleId = 'foot' | 'openRover' | 'pressRover' | 'robotRover' | 'heli';
export type RouteStyle = 'safest' | 'fastest' | 'eco';
export type Severity = 'note' | 'advisory' | 'caution' | 'warning';

/* ---------- conditions ---------- */

export interface Scenario {
  dust: 'clear' | 'regionalStorm' | 'globalStorm';
  /** Only for a regional storm. */
  storm?: { lon: number; lat: number; radiusKm: number };
  /** A solar particle event is under way. */
  solarEvent: boolean;
  /** 0 at solar minimum (more cosmic rays), 1 at solar maximum. */
  solarCycle: number;
}

export interface Conditions {
  tempC: number;
  pressurePa: number;
  /** Dust optical depth. */
  tau: number;
  doseMSvPerSol: number;
  visibilityKm: number;
  sunElevDeg: number;
  sunAzDeg: number;
  ltstH: number;
}

/* ---------- vehicles ---------- */

export interface Vehicle {
  id: VehicleId;
  name: string;
  /** One plain sentence for the picker. */
  blurb: string;
  kind: 'walk' | 'ground' | 'air';
  crew: number;
  /** Speed on flat ground, m/s. Speed by slope comes from vehicles.speedMs(). */
  flatSpeedMs: number;
  comfortSlopeDeg: number;
  blockSlopeDeg: number;
  /** Total battery, kWh. 0 for walkers. */
  batteryKWh: number;
  /** Range extender, kWh. 0 if none. */
  extenderKWh: number;
  /** Peak solar input at noon under a clear sky, kW. */
  solarKW: number;
  /** Power drawn while parked or moving for life support, heaters and avionics, W. */
  hotelW: number;
  ecoHotelW: number;
  massKg: number;
  /** Suit or cabin oxygen carried per person, kg. 0 for robots. */
  o2KgPerPerson: number;
  /** Hours the CO2 scrubbers last per person. 0 where it does not apply. */
  scrubberH: number;
  /** A pressurised cabin: crew ride without spending suit air. */
  cabin: boolean;
  /** Fraction of the outside dose that reaches the crew, 0 to 1. */
  doseFactor: number;
  needsDaylight: boolean;
  canCamp: boolean;
  eyeHeightM: number;
  /** Length and width on the ground, m. */
  footprintM: readonly [number, number];
}

/* ---------- mission plan ---------- */

export type TaskKind = 'sample' | 'photo' | 'measure' | 'survey' | 'custom';

export interface Task {
  id: string;
  kind: TaskKind;
  /** Shown instead of the kind's default name; required for 'custom'. */
  label?: string;
  minutes: number;
}

export interface Waypoint {
  lon: number;
  lat: number;
  name?: string;
  placeId?: string;
}

export interface Stop extends Waypoint {
  id: string;
  tasks: Task[];
}

export interface MissionPlan {
  start: Waypoint | null;
  stops: Stop[];
  /** Go back to the start after the last stop. */
  roundTrip: boolean;
  vehicle: VehicleId;
  style: RouteStyle;
  campAtNight: boolean;
}

/* ---------- trip ---------- */

export type TripState = 'move' | 'work' | 'wait' | 'camp';
export type TripLimit = 'o2' | 'scrubber' | 'battery' | 'daylight' | 'slope' | 'cold';

export interface TripStop {
  /** Index into the path where the crew stops. */
  index: number;
  workMin: number;
  name?: string;
}

export interface TripOptions {
  vehicle: VehicleId;
  departUtcMs: number;
  scenario: Scenario;
  style: RouteStyle;
  stops?: TripStop[];
  campAtNight?: boolean;
}

/** One per path point, taken on arrival at that point (after any work or wait there). */
export interface TripSample {
  distM: number;
  /** Seconds since departure. */
  tS: number;
  utcMs: number;
  elev: number;
  gradeDeg: number;
  speedMs: number;
  state: TripState;
  /** Oxygen left for the whole crew, kg. Null for robots. */
  o2Kg: number | null;
  /** Battery left, kWh. Null for walkers. */
  batteryKWh: number | null;
  /** Water used so far by the crew, litres. Null for robots. */
  waterL: number | null;
  /** Dose so far, mSv. */
  doseMSv: number;
  tempC: number;
  tau: number;
  sunElevDeg: number;
}

export interface TripWarning {
  severity: Severity;
  /** Stable machine code, e.g. 'o2-out', 'ends-after-dark'. */
  code: string;
  /** Plain words for the UI. */
  text: string;
  /** Path index it refers to, if any. */
  index?: number;
}

export interface TripTotals {
  distM: number;
  durationS: number;
  movingS: number;
  workS: number;
  waitS: number;
  climbM: number;
  descentM: number;
  maxGradeDeg: number;
  energyKWh: number;
  solarKWh: number;
  o2Kg: number;
  waterL: number;
  doseMSv: number;
  minTempC: number;
  maxTau: number;
  arriveUtcMs: number;
  /** Lowest oxygen and battery reached, as a fraction of what was carried. Null where not applicable. */
  minO2Frac: number | null;
  minBatteryFrac: number | null;
}

export interface NightStop {
  index: number;
  fromUtcMs: number;
  toUtcMs: number;
}

export interface TripResult {
  totals: TripTotals;
  samples: TripSample[];
  warnings: TripWarning[];
  feasible: boolean;
  limitHit: TripLimit | null;
  pointOfNoReturnIndex: number | null;
  o2OutIndex: number | null;
  walkbackIndex: number | null;
  nightStops: NightStop[];
}

/* ---------- terrain ---------- */

/**
 * A height grid cut from Web Mercator DEM tiles. Row 0 is the north edge, column 0 the west edge.
 * Cells are square on the ground locally; their size changes slowly with latitude, so ask per row.
 */
export interface Grid {
  rows: number;
  cols: number;
  west: number;
  south: number;
  east: number;
  north: number;
  /** Row-major heights in metres. */
  heights: Float32Array;
  /** Cell size in metres at the grid's central row. */
  cellWidthM: number;
  cellM(row: number): number;
  latOf(row: number): number;
  lonOf(col: number): number;
  /** Fractional row and column; may fall outside the grid. */
  rowOf(lat: number): number;
  colOf(lon: number): number;
  /** Bilinear height at a point, clamped to the grid. */
  elevation(lat: number, lon: number): number;
  /** Horn's method. */
  slopeDeg(row: number, col: number): number;
  /** Terrain ruggedness index: mean absolute height difference to the 8 neighbours, m. */
  ruggedness(row: number, col: number): number;
  /** A copy of a window, edges inclusive of r0/c0 and exclusive of r1/c1. */
  crop(r0: number, c0: number, r1: number, c1: number): Grid;
}

/* ---------- routing ---------- */

export interface HazardZone {
  id: string;
  kind: 'dustDevil' | 'storm' | 'steep' | 'keepOut';
  lon: number;
  lat: number;
  radiusM: number;
}

export interface RouteRequest {
  /** Echoed in every reply so stale replies can be dropped. */
  requestId: number;
  from: LonLat;
  to: LonLat;
  vehicle: VehicleId;
  style: RouteStyle;
  departUtcMs: number;
  scenario: Scenario;
  hazards: HazardZone[];
}

export type RouteFailureReason = 'outsideRegion' | 'blockedStart' | 'blockedEnd' | 'noPath' | 'tooFar';

export type RouteReply =
  | { ok: true; requestId: number; style: RouteStyle; path: PathPoint[]; gridCellM: number; expanded: number }
  | {
      ok: false;
      requestId: number;
      style: RouteStyle;
      reason: RouteFailureReason;
      /** Plain words for the UI. */
      message: string;
      /** The nearest point the vehicle could reach, when the start or end is blocked. */
      nearest?: LonLat;
    };

/** One routed and costed path for a single style, before merging. */
export interface RouteCandidate {
  style: RouteStyle;
  path: PathPoint[];
  /** Path index of every stop in order: start, each stop, and the end. */
  stopIndices: number[];
  trip: TripResult;
}

/** What the route card shows: one or more styles that came out the same. */
export interface RouteAlternative {
  id: string;
  styles: RouteStyle[];
  /** e.g. "Safest, fastest and eco agree" or "Fastest". */
  label: string;
  /** e.g. "Quickest", "Least O2", "Least power", "Same time as Safest". */
  badges: string[];
  path: PathPoint[];
  stopIndices: number[];
  trip: TripResult;
}

/* ---------- alerts ---------- */

export type AlertAction = 'reroute' | 'turnBack' | 'shelter' | 'wait' | 'slowDown';

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  /** One or two short sentences. */
  body: string;
  source: 'event' | 'lookahead' | 'trip' | 'base' | 'spaceWeather';
  atUtcMs: number;
  position?: LonLat;
  hazardId?: string;
  /** What Apply would do. Absent for alerts that only inform. */
  action?: { kind: AlertAction; label: string };
  /** A short line for speech synthesis. */
  speak?: string;
  resolved?: 'applied' | 'ignored' | 'expired';
}

/** What the look-ahead and the HUD need to know about a crew at one moment. */
export interface CrewSnapshot {
  utcMs: number;
  /** Distance along the current path, m. */
  distM: number;
  lon: number;
  lat: number;
  elev: number;
  headingDeg: number;
  speedMs: number;
  state: TripState | 'done' | 'returning';
  o2Kg: number | null;
  o2Frac: number | null;
  batteryKWh: number | null;
  batteryFrac: number | null;
  doseMSv: number;
}
