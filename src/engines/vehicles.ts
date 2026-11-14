/**
 * The five ways to cross the ground, and how fast each goes on a slope. Modelled: the numbers come from the
 * build spec, from the real machine each vehicle is patterned on, or are marked as assumptions.
 */
import type { TaskKind, Vehicle, VehicleId } from './types';

const RAD = Math.PI / 180;

/** Walking pace of a suited crew on level ground, km/h (build spec: the suit cap). */
export const SUIT_FLAT_KMH = 3.3;

/** Default length of each science task, minutes (build spec). */
export const TASK_MINUTES: Record<TaskKind, number> = { sample: 45, photo: 10, measure: 20, survey: 60, custom: 15 };

/** Rolling resistance of a wheel on loose regolith, as a fraction of weight (assumption; with the drivetrain loss it matches the Apollo lunar rover’s use of about 0.2 of its weight per metre). */
export const ROLLING_RESISTANCE = 0.15;
/** Share of battery energy that reaches the wheels (assumption). */
export const DRIVE_EFFICIENCY = 0.75;
/** Power a small helicopter draws in flight, W (Ingenuity: about 350 W, NASA press kit). */
export const FLIGHT_W = 350;
/** Speed kept by an eco driving style, as a share of normal (assumption). Applies to ground vehicles with a battery. */
export const ECO_SPEED_FACTOR = 0.8;
/** Speed used to cost a stretch that is too steep, as a share of flat speed (assumption), so a blocked route can still be drawn. */
export const CRAWL_FRACTION = 0.1;
/** Steady electrical power from a radioisotope generator, W. Perseverance’s MMRTG gives about 110 W (NASA/DOE). */
export const RTG_W: Record<VehicleId, number> = { foot: 0, openRover: 0, pressRover: 0, robotRover: 110, heli: 0 };

export const VEHICLES: Record<VehicleId, Vehicle> = {
  foot: {
    id: 'foot',
    name: 'On foot',
    blurb: 'Two people walking in suits, with air for one working day.',
    kind: 'walk',
    crew: 2, // build spec
    flatSpeedMs: SUIT_FLAT_KMH / 3.6, // build spec: 3.3 km/h
    comfortSlopeDeg: 15, // assumption: Apollo crews found slopes past about 15 degrees slow and tiring
    blockSlopeDeg: 25, // build spec
    batteryKWh: 0,
    extenderKWh: 0,
    solarKW: 0,
    hotelW: 0,
    ecoHotelW: 0,
    massKg: 120, // build spec: 75 kg body + 45 kg suit, per walker
    o2KgPerPerson: 0.9, // build spec: 12 h at 250 W
    scrubberH: 8, // build spec
    cabin: false,
    doseFactor: 1, // assumption: a suit stops almost no cosmic rays
    needsDaylight: true,
    canCamp: false,
    eyeHeightM: 1.7, // assumption: eye level in a helmet
    footprintM: [0.6, 0.6],
  },
  openRover: {
    id: 'openRover',
    name: 'Open rover',
    blurb: 'An open two-seat buggy, quick on gentle ground, with the crew in suits.',
    kind: 'ground',
    crew: 2,
    flatSpeedMs: 10 / 3.6, // Apollo lunar rover: cruised at about 10 km/h
    comfortSlopeDeg: 10, // assumption
    blockSlopeDeg: 20, // Apollo lunar rover: rated for slopes to about 20 to 25 degrees
    batteryKWh: 16, // assumption: about twice the lunar rover’s 8.7 kWh, for Mars gravity
    extenderKWh: 0,
    solarKW: 0.3, // assumption: about 2 m2 of panel at Mars noon
    hotelW: 250, // assumption: avionics, radio, lights
    ecoHotelW: 150, // assumption
    massKg: 700, // Apollo lunar rover: 210 kg empty, about 700 kg with crew and gear
    o2KgPerPerson: 0.9, // the crew breathe suit air the whole way
    scrubberH: 8,
    cabin: false,
    doseFactor: 1,
    needsDaylight: true,
    canCamp: false,
    eyeHeightM: 1.9, // assumption: seated on the chassis
    footprintM: [3.1, 2.3], // Apollo lunar rover: 3.1 m long, 2.3 m wide
  },
  pressRover: {
    id: 'pressRover',
    name: 'Pressurised rover',
    blurb: 'A cabin on wheels where two people can live for days and camp overnight.',
    kind: 'ground',
    crew: 2, // NASA Space Exploration Vehicle concept: two crew
    flatSpeedMs: 10 / 3.6, // NASA Space Exploration Vehicle concept: about 10 km/h
    comfortSlopeDeg: 15, // assumption
    blockSlopeDeg: 25, // assumption: kept below the concept’s claimed limit for loose ground
    batteryKWh: 150, // build spec
    extenderKWh: 400, // build spec: range extender
    solarKW: 2, // assumption: about 13 m2 of roof panel at Mars noon
    hotelW: 1500, // assumption: life support, heating and avionics for two
    ecoHotelW: 1000, // assumption
    massKg: 4000, // approximate: the Space Exploration Vehicle concept with crew and stores
    o2KgPerPerson: 12, // two weeks at NASA’s planning figure of 0.84 kg per person per day
    scrubberH: 336, // two weeks, matching the oxygen
    cabin: true,
    doseFactor: 0.7, // assumption: cabin walls and stored water stop about a third of the dose
    needsDaylight: false,
    canCamp: true,
    eyeHeightM: 2.4, // assumption: cockpit windows
    footprintM: [4.5, 4.0], // NASA Space Exploration Vehicle concept: 4.5 m long, 4 m wide
  },
  robotRover: {
    id: 'robotRover',
    name: 'Robotic rover',
    blurb: 'A robot the size of a car that creeps along and needs no air.',
    kind: 'ground',
    crew: 0,
    flatSpeedMs: 152 / 3600, // Perseverance: top speed 152 m per hour
    comfortSlopeDeg: 15, // assumption: Perseverance planners prefer gentle ground
    blockSlopeDeg: 30, // Perseverance: built to stand a 30 degree tilt
    batteryKWh: 2.4, // approximate: Perseverance carries two 43 Ah lithium-ion batteries
    extenderKWh: 0,
    solarKW: 0, // powered by a radioisotope generator, see RTG_W
    hotelW: 110, // assumption: computers and heaters awake, about what the generator gives
    ecoHotelW: 60, // assumption: asleep, heaters only
    massKg: 1025, // Perseverance
    o2KgPerPerson: 0,
    scrubberH: 0,
    cabin: false,
    doseFactor: 1,
    needsDaylight: true, // Perseverance drives by day
    canCamp: false,
    eyeHeightM: 2.0, // Perseverance: mast cameras about 2 m up
    footprintM: [3.0, 2.7], // Perseverance: 3 m long, 2.7 m wide
  },
  heli: {
    id: 'heli',
    name: 'Helicopter',
    blurb: 'A small robot helicopter that hops about a kilometre on one charge.',
    kind: 'air',
    crew: 0,
    flatSpeedMs: 5, // Ingenuity: cruised at about 5 m/s, peaked at 10 m/s
    comfortSlopeDeg: 90, // it flies over the ground, so no slope along the way slows or stops it
    blockSlopeDeg: 90,
    batteryKWh: 0.036, // Ingenuity: six lithium-ion cells, about 36 Wh
    extenderKWh: 0,
    solarKW: 0.01, // approximate: Ingenuity’s small panel at Mars noon
    hotelW: 1, // approximate: heaters and avionics averaged over a sol
    ecoHotelW: 1,
    massKg: 1.8, // Ingenuity
    o2KgPerPerson: 0,
    scrubberH: 0,
    cabin: false,
    doseFactor: 1,
    needsDaylight: true,
    canCamp: false,
    eyeHeightM: 10, // Ingenuity: usually flew about 10 m up
    footprintM: [1.2, 1.2], // Ingenuity: rotors 1.2 m across
  },
};

/** Tobler’s hiking function, km/h: 6 exp(-3.5 |tan(slope) + 0.05|) (Tobler 1993). About 5.04 km/h on the flat. */
function toblerRawKmh(gradeDeg: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(Math.tan(gradeDeg * RAD) + 0.05));
}

const TOBLER_SCALE = SUIT_FLAT_KMH / toblerRawKmh(0);

/**
 * Walking pace in a suit on a signed grade (degrees, uphill positive), km/h: Tobler’s hiking function scaled
 * so that flat ground gives 3.3 km/h, and held to 3.3 km/h where Tobler would let a gentle descent go faster,
 * because the suit sets the top pace.
 */
export function toblerKmh(gradeDeg: number): number {
  const g = Number.isFinite(gradeDeg) ? Math.max(-89, Math.min(89, gradeDeg)) : 0;
  return Math.min(SUIT_FLAT_KMH, TOBLER_SCALE * toblerRawKmh(g));
}

/**
 * Speed on a signed grade (degrees, uphill positive), m/s. Zero at or beyond the vehicle’s blocking slope,
 * up or down. Walkers follow toblerKmh. Wheeled vehicles keep full speed on the level, fall to half at
 * their comfortable slope and to 15% just short of the blocking slope (assumption). Aircraft ignore the ground.
 */
export function speedMs(v: Vehicle, gradeDeg: number): number {
  if (v.kind === 'air') return v.flatSpeedMs;
  const grade = Number.isFinite(gradeDeg) ? gradeDeg : 0;
  const steep = Math.abs(grade);
  if (steep >= v.blockSlopeDeg) return 0;
  if (v.kind === 'walk') return toblerKmh(grade) / 3.6;
  if (steep <= v.comfortSlopeDeg) return v.flatSpeedMs * (1 - 0.5 * (steep / Math.max(v.comfortSlopeDeg, 1e-9)));
  const past = (steep - v.comfortSlopeDeg) / (v.blockSlopeDeg - v.comfortSlopeDeg);
  return v.flatSpeedMs * (0.5 - 0.35 * past);
}
