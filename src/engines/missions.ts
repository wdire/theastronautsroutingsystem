/**
 * Scenario missions: four ready-made plans, one per way of getting about, each with a rule that says
 * whether a run of it succeeded. The plans load into the planner, where everything can be changed; the
 * rule judges what the simulation reports at the end.
 *
 * Positions are the places in public/data/places.json (Perseverance's named sites) and, beyond the
 * crater, the IAU names in public/data/names.json.
 */
import { fmtDuration, fmtPercent } from '../lib/format';
import { TASK_DEFAULT_MIN, newId } from '../store';
import type { MissionPlan, RouteStyle, TaskKind, VehicleId } from './types';

export interface MissionPlace {
  name: string;
  lon: number;
  lat: number;
  /** The planner's id for a site in places.json ("place:three-forks"); absent for a point that is only a name. */
  placeId?: string;
}

export interface MissionStop {
  place: MissionPlace;
  tasks: TaskKind[];
}

/** What the simulation reports when a mission ends. */
export interface MissionOutcome {
  tasksDone: number;
  tasksPlanned: number;
  /** Where the crew (or the aircraft) finished. */
  endedAt: 'start' | 'lastStop' | 'elsewhere';
  /** Oxygen and battery left, as a fraction of what was carried. Null where the vehicle has none. */
  o2LeftFrac: number | null;
  batteryLeftFrac: number | null;
  hours: number;
}

export interface MissionVerdict {
  success: boolean;
  /** One plain sentence for the debrief. */
  line: string;
}

export interface Mission {
  id: string;
  title: string;
  /** One sentence, plain English. */
  brief: string;
  vehicle: VehicleId;
  style: RouteStyle;
  start: MissionPlace;
  stops: MissionStop[];
  roundTrip: boolean;
  campAtNight: boolean;
  judge(outcome: MissionOutcome): MissionVerdict;
}

/** What a mission must leave in hand. Reserves are fractions of what was carried. */
interface SuccessRule {
  minO2Frac?: number;
  minBatteryFrac?: number;
  maxHours?: number;
  /** Why the time limit exists, for the failure line, e.g. "before dark". */
  maxHoursWhy?: string;
  /** "the crew" or "the helicopter". */
  who: string;
}

const P = {
  landing: { placeId: 'place:octavia-e-butler-landing', name: 'Octavia E. Butler Landing', lon: 77.450886, lat: 18.444627 },
  threeForks: { placeId: 'place:three-forks', name: 'Three Forks sample depot', lon: 77.408447, lat: 18.453372 },
  wildcatRidge: { placeId: 'place:wildcat-ridge', name: 'Wildcat Ridge', lon: 77.405925, lat: 18.458647 },
  deltaFront: { placeId: 'place:jezero-delta-front', name: 'Jezero delta front', lon: 77.401422, lat: 18.450566 },
  belva: { placeId: 'place:belva-crater', name: 'Belva crater', lon: 77.369008, lat: 18.482929 },
  // A helicopter carries six minutes of flight: it works from a pad set down on the delta top near its target.
  belvaPad: { name: 'Delta-top helipad', lon: 77.377382, lat: 18.476653 },
  brightAngel: { placeId: 'place:bright-angel', name: 'Bright Angel', lon: 77.303836, lat: 18.496112 },
  // The valley's IAU centre, where it cuts through the crater rim: the breach.
  breach: { name: 'Neretva Vallis breach', lon: 77.2, lat: 18.55 },
  // Nili Planum is a wide plain; its IAU centre is the point named for it, just outside the rim.
  niliPlanum: { name: 'Nili Planum', lon: 77.1, lat: 18.6 },
  lookoutHill: { placeId: 'place:lookout-hill', name: 'Lookout Hill', lon: 77.268527, lat: 18.457528 },
  witchHazelHill: { placeId: 'place:witch-hazel-hill', name: 'Witch Hazel Hill', lon: 77.264745, lat: 18.460553 },
  krokodillen: { placeId: 'place:krokodillen', name: 'Krokodillen', lon: 77.257218, lat: 18.460917 },
} as const satisfies Record<string, MissionPlace>;

function judgeBy(rule: SuccessRule, start: MissionPlace, last: MissionPlace, roundTrip: boolean) {
  return (o: MissionOutcome): MissionVerdict => {
    const home = roundTrip ? start : last;
    const atHome = o.endedAt === (roundTrip ? 'start' : 'lastStop');
    const left = o.tasksPlanned - o.tasksDone;
    const fails: string[] = [];
    if (left > 0) fails.push(`${left} of ${o.tasksPlanned} ${o.tasksPlanned === 1 ? 'task was' : 'tasks were'} left undone`);
    if (!atHome) fails.push(`${rule.who} did not get back to ${home.name}`);
    if (rule.minO2Frac !== undefined && o.o2LeftFrac !== null && o.o2LeftFrac < rule.minO2Frac) {
      fails.push(`oxygen fell to ${fmtPercent(o.o2LeftFrac)}, under the ${fmtPercent(rule.minO2Frac)} reserve`);
    }
    if (rule.minBatteryFrac !== undefined && o.batteryLeftFrac !== null && o.batteryLeftFrac < rule.minBatteryFrac) {
      fails.push(`the battery fell to ${fmtPercent(o.batteryLeftFrac)}, under the ${fmtPercent(rule.minBatteryFrac)} reserve`);
    }
    if (rule.maxHours !== undefined && o.hours > rule.maxHours) {
      fails.push(`it took ${fmtDuration(o.hours * 3600)}, over the ${fmtDuration(rule.maxHours * 3600)} allowed ${rule.maxHoursWhy ?? ''}`.trim());
    }
    if (fails.length) {
      const [first, ...rest] = fails;
      const text = rest.length ? `${first}; also ${rest.join('; ')}` : (first ?? '');
      return { success: false, line: `Not a success: ${text}.` };
    }
    const reserves: string[] = [];
    if (o.o2LeftFrac !== null) reserves.push(`${fmtPercent(o.o2LeftFrac)} oxygen`);
    if (o.batteryLeftFrac !== null) reserves.push(`${fmtPercent(o.batteryLeftFrac)} battery`);
    const tail = reserves.length ? ` with ${reserves.join(' and ')} left` : '';
    const who = rule.who.charAt(0).toUpperCase() + rule.who.slice(1);
    return {
      success: true,
      line: `Success: all ${o.tasksPlanned} ${o.tasksPlanned === 1 ? 'task' : 'tasks'} done. ${who} reached ${home.name} after ${fmtDuration(o.hours * 3600)}${tail}.`,
    };
  };
}

interface MissionData extends Omit<Mission, 'judge'> {
  rule: SuccessRule;
}

function mission(data: MissionData): Mission {
  const { rule, ...rest } = data;
  const last = rest.stops[rest.stops.length - 1]?.place ?? rest.start;
  return { ...rest, judge: judgeBy(rule, rest.start, last, rest.roundTrip) };
}

export const MISSIONS: readonly Mission[] = [
  mission({
    id: 'delta',
    title: 'Sample run to the delta',
    brief: 'Walk from the sample depot to the foot of the old river delta, core a sample at Wildcat Ridge, survey the delta front and walk home.',
    vehicle: 'foot',
    style: 'safest',
    start: P.threeForks,
    stops: [
      { place: P.wildcatRidge, tasks: ['sample', 'photo'] },
      { place: P.deltaFront, tasks: ['survey'] },
    ],
    roundTrip: true,
    campAtNight: false,
    // Suits carry about 12 h of oxygen; 15% held back is close to two hours of slow walking home.
    rule: { who: 'the crew', minO2Frac: 0.15, maxHours: 10, maxHoursWhy: 'for a walk in suits' },
  }),
  mission({
    id: 'breach',
    title: 'Out through the breach to Nili Planum',
    brief: 'Drive the pressurised rover across the crater floor, up Neretva Vallis where the river broke through the rim, and out onto Nili Planum, camping on the way.',
    vehicle: 'pressRover',
    style: 'safest',
    start: P.landing,
    stops: [
      { place: P.deltaFront, tasks: ['photo'] },
      { place: P.brightAngel, tasks: ['sample', 'measure'] },
      { place: P.breach, tasks: ['survey', 'photo'] },
      { place: P.niliPlanum, tasks: ['sample', 'survey'] },
    ],
    roundTrip: true,
    campAtNight: true,
    // Five sols out and back, with enough charge and air held back to sit out a dust storm.
    rule: { who: 'the crew', minO2Frac: 0.2, minBatteryFrac: 0.15, maxHours: 5 * 24.66, maxHoursWhy: 'for the expedition' },
  }),
  mission({
    id: 'rim',
    title: 'West rim survey',
    brief: 'Drive the open rover along the western rim, among some of the oldest rocks a crew could reach here, and back again in suits.',
    vehicle: 'openRover',
    style: 'safest',
    start: P.lookoutHill,
    stops: [
      { place: P.witchHazelHill, tasks: ['survey'] },
      { place: P.krokodillen, tasks: ['sample', 'photo'] },
    ],
    roundTrip: true,
    campAtNight: false,
    // The crew breathe suit air the whole way and the rover has no shelter, so both reserves matter.
    rule: { who: 'the crew', minO2Frac: 0.2, minBatteryFrac: 0.2, maxHours: 8, maxHoursWhy: 'in an open rover' },
  }),
  mission({
    id: 'belva',
    title: 'Scout Belva crater by air',
    brief: 'Fly the helicopter from a pad on the delta top, 600 m out, to look into Belva crater, a hole punched through the delta that shows its layers in cross-section.',
    vehicle: 'heli',
    style: 'safest',
    start: P.belvaPad,
    stops: [{ place: P.belva, tasks: ['photo'] }],
    roundTrip: true,
    campAtNight: false,
    // A helicopter that lands flat cannot heat itself through the night.
    rule: { who: 'the helicopter', minBatteryFrac: 0.2, maxHours: 8, maxHoursWhy: 'before dark' },
  }),
];

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** A fresh plan for the planner, with new ids so two loads of the same mission never share a stop or task. */
export function toPlan(m: Mission, makeId: (prefix: string) => string = newId): MissionPlan {
  const at = (p: MissionPlace) => ({ lon: p.lon, lat: p.lat, name: p.name, ...(p.placeId ? { placeId: p.placeId } : {}) });
  return {
    start: at(m.start),
    stops: m.stops.map((s) => ({
      ...at(s.place),
      id: makeId('s'),
      tasks: s.tasks.map((kind) => ({ id: makeId('t'), kind, minutes: TASK_DEFAULT_MIN[kind] })),
    })),
    roundTrip: m.roundTrip,
    vehicle: m.vehicle,
    style: m.style,
    campAtNight: m.campAtNight,
  };
}
