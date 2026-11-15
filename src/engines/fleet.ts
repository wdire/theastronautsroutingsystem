/**
 * Who and what goes on a mission: a number of people and a fleet of vehicles. The fleet travels together, so
 * the trip is costed for the member that holds it back most (its "pace" vehicle): anyone without a seat walks,
 * and then the whole convoy moves at walking pace on suit air. Robots carry no one and set the pace only when
 * nobody goes.
 */
import { MARS_G } from '../lib/constants';
import { walkingW, o2KgPerHour } from './metabolic';
import type { FleetEntry, MissionPlan, Vehicle, VehicleId } from './types';
import { DRIVE_EFFICIENCY, FLIGHT_W, ROLLING_RESISTANCE, SUIT_FLAT_KMH, VEHICLES } from './vehicles';

/** Vehicles that can be added to a fleet, in the order the picker lists them. Walking is what people do without one. */
export const FLEET_VEHICLES: readonly VehicleId[] = ['openRover', 'pressRover', 'robotRover', 'heli'];
/** Most of one vehicle in a fleet (assumption: what a small base keeps). */
export const MAX_OF_EACH = 4;
/** Most people on a mission: the crew server's limit too. */
export const MAX_PEOPLE = 8;

/** The fleet a plan takes. Plans from before fleets carry only a vehicle: that one, alone. */
export function fleetOf(plan: Pick<MissionPlan, 'vehicle' | 'fleet'>): FleetEntry[] {
  if (plan.fleet) return plan.fleet.filter((f) => f.count > 0 && FLEET_VEHICLES.includes(f.vehicle));
  return plan.vehicle === 'foot' ? [] : [{ vehicle: plan.vehicle, count: 1 }];
}

/** How many people go. Plans from before fleets: the vehicle's usual crew (two walkers, two in a rover). */
export function peopleOf(plan: Pick<MissionPlan, 'vehicle' | 'people'>): number {
  if (plan.people !== undefined) return Math.max(0, Math.min(MAX_PEOPLE, Math.round(plan.people)));
  return VEHICLES[plan.vehicle].crew;
}

const countOf = (fleet: readonly FleetEntry[], id: VehicleId): number => fleet.find((f) => f.vehicle === id)?.count ?? 0;

export interface FleetCheck {
  /** The vehicle the trip is costed for: the one that holds the convoy back. */
  pace: VehicleId;
  people: number;
  seats: number;
  /** People with no seat, who walk. */
  walkers: number;
  /** Reasons the mission cannot go as it stands. Start stays off while any is present. */
  problems: string[];
  /** Things worth knowing that do not stop it. */
  notes: string[];
}

/** Works out how a fleet travels with a number of people, and what is wrong with it. */
export function checkFleet(fleet: readonly FleetEntry[], people: number): FleetCheck {
  const open = countOf(fleet, 'openRover');
  const press = countOf(fleet, 'pressRover');
  const robot = countOf(fleet, 'robotRover');
  const heli = countOf(fleet, 'heli');
  const crewed = open + press;
  const seats = open * VEHICLES.openRover.crew + press * VEHICLES.pressRover.crew;
  const walkers = Math.max(0, people - seats);
  const problems: string[] = [];
  const notes: string[] = [];

  let pace: VehicleId;
  if (people > 0) {
    // Riders in an open rover breathe suit air; they set the limit before a cabin does.
    pace = walkers > 0 ? 'foot' : open > 0 ? 'openRover' : 'pressRover';
    if (crewed > people) {
      problems.push(`${crewed} crewed ${crewed === 1 ? 'vehicle needs' : 'vehicles need'} ${crewed === 1 ? 'a driver' : `${crewed} drivers`}, and ${people === 1 ? 'only one person is' : `only ${people} people are`} going. Take fewer rovers or more people.`);
    }
    if (walkers > 0 && seats > 0) {
      notes.push(`${walkers} of ${people} ${walkers === 1 ? 'has' : 'have'} no seat and ${walkers === 1 ? 'walks' : 'walk'} beside the rovers, so the convoy keeps walking pace (${SUIT_FLAT_KMH} km/h) and suit air sets the limit.`);
    }
    if (open > 0 && press > 0 && walkers === 0) notes.push('Riders in the open rover breathe suit air: that, not the cabin, sets the oxygen limit.');
    if (robot > 0) notes.push(`The robotic rover drives itself at ${Math.round(VEHICLES.robotRover.flatSpeedMs * 3600)} m an hour. It follows on its own and does not set the pace.`);
  } else {
    if (robot === 0 && heli === 0) problems.push('Nobody is going. Add people, or a robot to send instead.');
    if (crewed > 0) problems.push('Crewed rovers need someone to drive them. Add people, or send only robots.');
    pace = robot > 0 ? 'robotRover' : 'heli';
  }
  if (heli > 0 && pace !== 'heli') notes.push('The helicopter scouts ahead in hops of under a kilometre, by day. It does not set the pace.');
  return { pace, people, seats, walkers, problems, notes };
}

/** The plan with a new fleet and head count, and the pace vehicle that follows from them. */
export function withFleet(plan: MissionPlan, fleet: readonly FleetEntry[], people: number): MissionPlan {
  const clean = FLEET_VEHICLES.map((vehicle) => ({ vehicle, count: Math.max(0, Math.min(MAX_OF_EACH, Math.round(countOf(fleet, vehicle)))) })).filter((f) => f.count > 0);
  const p = Math.max(0, Math.min(MAX_PEOPLE, Math.round(people)));
  return { ...plan, fleet: clean, people: p, vehicle: checkFleet(clean, p).pace };
}

/* ---------- what a vehicle can do, in round numbers for the picker ---------- */

/** Usable share of a battery on a trip (assumption: the rest is kept for the way back's surprises and the night). */
const USABLE = 0.8;

export interface VehicleFacts {
  seats: string;
  speed: string;
  slope: string;
  air: string | null;
  /** How far it goes, in words: out and back on level ground by day for most, a day's driving for the robot. */
  range: string | null;
}

function km(x: number): string {
  return x < 10 ? x.toFixed(1) : String(Math.round(x));
}

/** Plain facts for a vehicle's info card. Distances are level ground, by day, with no stops. */
export function vehicleFacts(v: Vehicle): VehicleFacts {
  const kmh = v.flatSpeedMs * 3.6;
  const seats = v.kind === 'walk' ? 'Each person walks in a suit' : v.crew > 0 ? `${v.crew} people` : 'No one: it runs itself';
  const speed = kmh < 1 ? `${Math.round(kmh * 1000)} m an hour` : `${kmh.toFixed(kmh < 5 ? 1 : 0)} km/h`;
  const slope = v.kind === 'air' ? 'Flies over it; lands on under 10 degrees' : `Up to ${v.blockSlopeDeg} degrees`;
  const air =
    v.crew <= 0 && v.kind !== 'walk'
      ? null
      : v.cabin
        ? `Cabin air for ${Math.round(v.scrubberH / 24)} days`
        : `Suit air for about ${v.scrubberH} hours`;

  // Battery range: energy a metre (rolling, plus the systems kept running for the time it takes) into what is usable.
  let batteryKm: number | null = null;
  if (v.kind === 'ground' && v.batteryKWh > 0) {
    const jPerM = (ROLLING_RESISTANCE * v.massKg * MARS_G) / DRIVE_EFFICIENCY + v.hotelW / v.flatSpeedMs;
    batteryKm = ((v.batteryKWh + v.extenderKWh) * USABLE * 3.6e6) / jPerM / 1000;
  } else if (v.kind === 'air') {
    batteryKm = (v.batteryKWh * USABLE * 3.6e6) / (FLIGHT_W / v.flatSpeedMs) / 1000;
  }
  // Air range for people in suits: walking, or riding with the suit on.
  let airKm: number | null = null;
  if (!v.cabin && (v.kind === 'walk' || v.crew > 0)) {
    const watts = v.kind === 'walk' ? walkingW(kmh, 0) : 150;
    const hours = Math.min(v.scrubberH, v.o2KgPerPerson / Math.max(1e-6, o2KgPerHour(watts)));
    airKm = hours * kmh;
  }
  const options = [batteryKm !== null ? { km: batteryKm, by: 'battery' } : null, airKm !== null ? { km: airKm, by: 'suit air' } : null].filter(
    (o): o is { km: number; by: string } => o !== null,
  );
  const limit = options.sort((a, b) => a.km - b.km)[0];
  if (v.id === 'robotRover') {
    // Its generator never runs out; what limits it is driving by day at its crawl (about six hours a sol).
    return { seats, speed, slope, air, range: `About ${km((v.flatSpeedMs * 3600 * 6) / 1000)} km a sol, for as many sols as it takes` };
  }
  return { seats, speed, slope, air, range: limit ? `About ${km(limit.km / 2)} km out and back, set by its ${limit.by}` : null };
}
