/**
 * The base's side of the chat. Rule based on purpose: every reply is built from the crew's snapshot and the
 * mission's own data, so it never states a fact the simulation does not hold.
 */
import { marsTime, nextSunrise, sunriseSunset } from '@/engines/marsTime';
import type { CrewSnapshot } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { fmtClock, fmtDistance, fmtDuration, fmtPercent, fmtTemp } from '@/lib/format';
import type { MissionRun } from './types';
import { progress } from './world';

type Topic = 'oxygen' | 'power' | 'sun' | 'radiation' | 'weather' | 'next' | 'time' | 'status';

/** Checked in order: "time to sunset" is about the sun, "next stop" about the route. */
const TOPICS: readonly (readonly [Topic, RegExp])[] = [
  ['oxygen', /\b(o2|oxygen|air|breath\w*)\b/],
  ['power', /\b(power|battery|batteries|charge|energy|kwh)\b/],
  ['sun', /\b(sunset|sundown|sunrise|daylight|dark|night|sun)\b/],
  ['radiation', /\b(radiation|dose|sievert\w*|msv|particle|flare)\b/],
  ['weather', /\b(dust|weather|storm|wind|devil|visibility|temperature|cold|tau)\b/],
  ['next', /\b(next|stop|where|distance|eta|arrive)\b|how far/],
  ['time', /\b(time|clock|hour|hours|sol|late)\b|how long/],
  ['status', /\b(status|report|update|ok|okay|doing)\b|how are/],
];

function topicOf(text: string): Topic | null {
  const q = text.toLowerCase();
  for (const [topic, re] of TOPICS) if (re.test(q)) return topic;
  return null;
}

function kmh(ms: number): string {
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

function clockAt(utcMs: number, lon: number): string {
  return fmtClock(marsTime(utcMs, lon).ltstH);
}

function oxygen(crew: CrewSnapshot, run: MissionRun): string {
  if (crew.o2Kg === null || crew.o2Frac === null) {
    return VEHICLES[run.vehicle].crew === 0
      ? 'This vehicle carries no crew, so there is no oxygen to track.'
      : 'Oxygen is not tracked on this run: the trip has no budget.';
  }
  const head = `Oxygen is at ${fmtPercent(crew.o2Frac)}, ${crew.o2Kg.toFixed(2)} kg for the crew.`;
  if (crew.o2Frac <= 0.2) return `${head} That is the reserve: head home now.`;
  if (crew.o2Frac <= 0.35) return `${head} The reserve starts at 20%, so keep the way home in mind.`;
  return head;
}

function power(crew: CrewSnapshot, run: MissionRun): string {
  if (crew.batteryKWh === null || crew.batteryFrac === null) {
    return VEHICLES[run.vehicle].batteryKWh === 0
      ? 'There is no battery on foot; suit air is the limit.'
      : 'The battery is not tracked on this run: the trip has no budget.';
  }
  const head = `Battery is at ${fmtPercent(crew.batteryFrac)}, ${crew.batteryKWh.toFixed(1)} kWh.`;
  return crew.batteryFrac < 0.15 ? `${head} That is low: drive gently and keep the rest for the way back.` : head;
}

function sun(crew: CrewSnapshot, run: MissionRun, utcMs: number): string {
  const { riseUtcMs, setUtcMs, dayLengthS } = sunriseSunset(utcMs, crew.lat, crew.lon);
  if (dayLengthS <= 0) return 'The sun does not rise here today.';
  const needs = VEHICLES[run.vehicle].needsDaylight ? ' This vehicle needs daylight.' : '';
  if (utcMs < riseUtcMs) {
    return `The sun is down. Sunrise at ${clockAt(riseUtcMs, crew.lon)} local solar time, in ${fmtDuration((riseUtcMs - utcMs) / 1000)}.${needs}`;
  }
  if (utcMs < setUtcMs) {
    return `Sunset at ${clockAt(setUtcMs, crew.lon)} local solar time, in ${fmtDuration((setUtcMs - utcMs) / 1000)}.${needs}`;
  }
  const rise = nextSunrise(utcMs, crew.lat, crew.lon);
  return `The sun set ${fmtDuration((utcMs - setUtcMs) / 1000)} ago. Next sunrise at ${clockAt(rise, crew.lon)}, in ${fmtDuration((rise - utcMs) / 1000)}.`;
}

function radiation(crew: CrewSnapshot, run: MissionRun): string {
  const head = `The dose so far is ${crew.doseMSv.toFixed(2)} mSv.`;
  return run.scenario.solarEvent
    ? `${head} A solar particle event is under way, so keep as much shielding overhead as you can.`
    : `${head} No solar particle event is under way.`;
}

function weather(crew: CrewSnapshot, run: MissionRun): string {
  let nearest: (typeof run.trip.samples)[number] | undefined;
  for (const s of run.trip.samples) {
    if (!nearest || Math.abs(s.distM - crew.distM) < Math.abs(nearest.distM - crew.distM)) nearest = s;
  }
  const here = nearest ? `Outside it is ${fmtTemp(nearest.tempC)} and the dust optical depth is ${nearest.tau.toFixed(1)}. ` : '';
  const sky =
    run.scenario.dust === 'globalStorm'
      ? 'A global dust storm is under way.'
      : run.scenario.dust === 'regionalStorm'
        ? 'A regional dust storm is reported in the region.'
        : 'No dust storm is in the forecast.';
  return `${here}${sky}`;
}

function next(crew: CrewSnapshot, run: MissionRun, utcMs: number): string {
  const p = progress(run, utcMs);
  if (crew.state === 'done') return `The mission is over. ${p.tasksDone} of ${p.tasksTotal} tasks done.`;
  if (p.nextDistM < 20) return `You are at ${p.nextName}. ${p.tasksDone} of ${p.tasksTotal} tasks done so far.`;
  return `Next is ${p.nextName}, ${fmtDistance(p.nextDistM)} ahead, about ${fmtDuration(p.nextS)} away.`;
}

function time(crew: CrewSnapshot, run: MissionRun, utcMs: number): string {
  const mt = marsTime(utcMs, crew.lon);
  const at = run.endedUtcMs !== undefined ? Math.min(utcMs, run.endedUtcMs) : utcMs;
  const out = run.carry.timeS + Math.max(0, (at - run.legStartUtcMs) / 1000);
  return `It is ${fmtClock(mt.ltstH)} local solar time on sol ${mt.sol}. The crew has been out ${fmtDuration(out)}.`;
}

function status(crew: CrewSnapshot, run: MissionRun, utcMs: number): string {
  const p = progress(run, utcMs);
  const doing: Record<CrewSnapshot['state'], string> = {
    move: `Moving at ${kmh(crew.speedMs)}`,
    returning: `Heading home at ${kmh(crew.speedMs)}`,
    work: 'Working at the stop',
    wait: 'Waiting',
    camp: 'Camped for the night',
    done: 'Mission over',
  };
  const along = run.carry.distM + crew.distM;
  const air = crew.o2Frac !== null ? `, oxygen ${fmtPercent(crew.o2Frac)}` : '';
  const bat = crew.batteryFrac !== null ? `, battery ${fmtPercent(crew.batteryFrac)}` : '';
  return `${doing[crew.state]}, ${fmtDistance(along)} covered${air}${bat}. ${p.tasksDone} of ${p.tasksTotal} tasks done.`;
}

/** The base's answer to a crew line, grounded in the crew's state at the moment of the reply. */
export function baseReply(text: string, crew: CrewSnapshot | null, run: MissionRun | null, utcMs: number): string {
  if (!crew || !run) return 'Base here. No mission is running. Plan a route and start it, and we will follow along.';
  switch (topicOf(text)) {
    case 'oxygen':
      return oxygen(crew, run);
    case 'power':
      return power(crew, run);
    case 'sun':
      return sun(crew, run, utcMs);
    case 'radiation':
      return radiation(crew, run);
    case 'weather':
      return weather(crew, run);
    case 'next':
      return next(crew, run, utcMs);
    case 'time':
      return time(crew, run, utcMs);
    case 'status':
      return status(crew, run, utcMs);
    default:
      return `Copy. ${status(crew, run, utcMs)}`;
  }
}
