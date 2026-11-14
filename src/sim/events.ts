/**
 * Events along a mission: a dust devil crossing the route, a regional storm notice, a solar particle event.
 * The schedule is drawn once at the start from the world's seeded generator, so a seed replays the same
 * mission. Each alert is written when it fires, from where the crew actually is then.
 */
import type { Alert, HazardZone, PathPoint } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { fmtDistance } from '@/lib/format';
import { bearingDeg, destination, distanceM } from '@/lib/geo';
import type { EventKind, MissionRun, ScheduledEvent, World } from './types';
import { crewAt, raiseAlert, timeAtDistance, timelineOf } from './world';

/** Mulberry32: a small, fast generator whose whole state is one 32-bit number. Returns [value in 0..1, next state]. */
export function rngNext(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Draw n values from a state. */
function draws(state: number, n: number): [number[], number] {
  const out: number[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const [v, next] = rngNext(s);
    out.push(v);
    s = next;
  }
  return [out, s];
}

/** Chance that a mission meets a dust devil (assumption: they are common on spring and summer afternoons). */
export const DUST_DEVIL_CHANCE = 0.6;
export const DEVIL_MIN_RADIUS_M = 150;
export const DEVIL_MAX_RADIUS_M = 300;
/** The alert comes this far before the devil's edge, m. */
export const DEVIL_WARNING_M = 600;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'north';
}

function pointAt(path: readonly PathPoint[], along: Float64Array, distM: number): { lon: number; lat: number; heading: number } {
  let i = 1;
  while (i < path.length - 1 && (along[i] ?? 0) < distM) i++;
  const a = path[i - 1] ?? path[0] ?? [0, 0, 0];
  const b = path[i] ?? a;
  const a0 = along[i - 1] ?? 0;
  const seg = (along[i] ?? a0) - a0;
  const f = seg > 0 ? Math.min(1, Math.max(0, (distM - a0) / seg)) : 0;
  return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, heading: bearingDeg(a[0], a[1], b[0], b[1]) };
}

/** Clear ground kept between a devil's edge and any stop, the base or the route's ends, m. */
export const DEVIL_CLEARANCE_M = 120;

/** The places a devil must never cover: every stop, home, and both ends of the path. */
function keepClear(run: MissionRun): [number, number][] {
  const pts: [number, number][] = [[run.home[0], run.home[1]]];
  for (const ls of run.legStops) {
    const p = run.path[ls.index];
    if (p) pts.push([p[0], p[1]]);
  }
  const first = run.path[0];
  const last = run.path[run.path.length - 1];
  if (first) pts.push([first[0], first[1]]);
  if (last) pts.push([last[0], last[1]]);
  return pts;
}

function covers(ev: ScheduledEvent, pts: readonly [number, number][]): boolean {
  if (ev.lon === undefined || ev.lat === undefined || ev.radiusM === undefined) return false;
  const reach = ev.radiusM + DEVIL_CLEARANCE_M;
  return pts.some(([lon, lat]) => distanceM(lon, lat, ev.lon!, ev.lat!) < reach);
}

/**
 * A devil near a distance along the route that leaves every stop and the base clear: a devil sitting on a stop
 * cannot be routed around, and a real crew would wait for it to pass instead. Tries the distance first, then
 * steps either way and shrinks the devil; null if the route has no clear stretch for one.
 */
function clearDevilNear(run: MissionRun, distM: number, minM: number, maxM: number, r: readonly number[], id: string): ScheduledEvent | null {
  const pts = keepClear(run);
  for (const shrink of [1, 0.7, 0.45]) {
    for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
      const d = distM + step * 150;
      if (d < minM || d > maxM) continue;
      const ev = devilAt(run, d, [(r[0] ?? 0.5) * shrink, r[1] ?? 0.5], id);
      if (!covers(ev, pts)) return ev;
    }
  }
  return null;
}

/** A devil on the route at a distance, nudged sideways a little but still across the line. */
function devilAt(run: MissionRun, distM: number, r: readonly number[], id: string): ScheduledEvent {
  const tl = timelineOf(run);
  const radiusM = DEVIL_MIN_RADIUS_M + (r[0] ?? 0.5) * (DEVIL_MAX_RADIUS_M - DEVIL_MIN_RADIUS_M);
  const p = pointAt(run.path, tl.along, distM);
  const side = ((r[1] ?? 0.5) - 0.5) * radiusM * 0.8;
  const [lon, lat] = destination(p.lon, p.lat, p.heading + 90, side);
  const triggerM = Math.max(0, distM - radiusM - DEVIL_WARNING_M);
  return { id, kind: 'dustDevil', atUtcMs: run.legStartUtcMs + timeAtDistance(run, triggerM) * 1000, lon, lat, radiusM };
}

/** The distance out to the far end: the last stop on a round trip, the end of the path otherwise. */
function outboundM(run: MissionRun): number {
  const tl = timelineOf(run);
  const total = tl.along[tl.along.length - 1] ?? 0;
  if (!run.homeIsAhead || run.legStops.length === 0) return total;
  return Math.max(...run.legStops.map((ls) => tl.along[ls.index] ?? 0));
}

/** The events a mission will meet, in time order, and the generator state after drawing them. */
export function scheduleEvents(run: MissionRun, rng: number): { events: ScheduledEvent[]; rng: number } {
  const [r, next] = draws(rng, 5);
  const events: ScheduledEvent[] = [];
  const tl = timelineOf(run);
  const outM = outboundM(run);
  if ((r[0] ?? 1) < DUST_DEVIL_CHANCE && outM >= 500) {
    const d = (0.3 + (r[1] ?? 0.5) * 0.35) * outM;
    const ev = clearDevilNear(run, d, 0.2 * outM, 0.8 * outM, [r[2] ?? 0.5, r[3] ?? 0.5], `dust:${run.id}`);
    if (ev) events.push(ev);
  }
  if (run.scenario.dust === 'regionalStorm' && run.scenario.storm) {
    const s = run.scenario.storm;
    events.push({ id: `storm:${run.id}`, kind: 'storm', atUtcMs: run.legStartUtcMs + 120_000, lon: s.lon, lat: s.lat, radiusM: s.radiusKm * 1000 });
  }
  if (run.scenario.solarEvent) {
    const span = tl.durationS > 0 ? tl.durationS : 3600;
    events.push({ id: `solar:${run.id}`, kind: 'solar', atUtcMs: run.legStartUtcMs + (0.1 + (r[4] ?? 0.5) * 0.3) * span * 1000 });
  }
  return { events: events.sort((a, b) => a.atUtcMs - b.atUtcMs), rng: next };
}

/** The alert (and hazard) for an event at a moment, or null if it no longer applies. */
export function eventAlert(run: MissionRun, ev: ScheduledEvent, atUtcMs: number): { alert: Alert; hazard?: HazardZone } | null {
  const crew = crewAt(run, atUtcMs);
  const v = VEHICLES[run.vehicle];
  if (ev.kind === 'dustDevil') {
    if (ev.lon === undefined || ev.lat === undefined || ev.radiusM === undefined) return null;
    const tl = timelineOf(run);
    // Only a devil that still crosses the route ahead is worth a word; a changed route may have left it behind.
    let best = Infinity;
    let bestAlong = 0;
    for (let i = 0; i < run.path.length; i++) {
      const a = tl.along[i] ?? 0;
      if (a < crew.distM - ev.radiusM) continue;
      if (a > crew.distM + 5000) break;
      const p = run.path[i];
      if (!p) continue;
      const d = distanceM(p[0], p[1], ev.lon, ev.lat);
      if (d < best) {
        best = d;
        bestAlong = a;
      }
    }
    if (best > ev.radiusM + 50) return null;
    const ahead = Math.max(0, bestAlong - crew.distM);
    const width = fmtDistance(2 * ev.radiusM);
    const hazard: HazardZone = { id: `hz:${ev.id}`, kind: 'dustDevil', lon: ev.lon, lat: ev.lat, radiusM: ev.radiusM };
    return {
      hazard,
      alert: {
        id: ev.id,
        severity: 'caution',
        title: 'Dust devil ahead',
        body: `A dust devil about ${width} across is ${fmtDistance(ahead)} ahead and crosses the route. Route around it, or carry on through the grit.`,
        source: 'event',
        atUtcMs,
        position: [ev.lon, ev.lat],
        hazardId: hazard.id,
        action: { kind: 'reroute', label: 'Route around it' },
        speak: `Dust devil ${fmtDistance(ahead).replace(/\s?m$/, ' metres').replace(/\s?km$/, ' kilometres')} ahead, crossing the route.`,
      },
    };
  }
  if (ev.kind === 'storm') {
    if (ev.lon === undefined || ev.lat === undefined || ev.radiusM === undefined) return null;
    const d = distanceM(crew.lon, crew.lat, ev.lon, ev.lat);
    const across = fmtDistance(2 * ev.radiusM);
    const inside = d <= ev.radiusM;
    return {
      alert: {
        id: ev.id,
        severity: 'advisory',
        title: 'Regional dust storm',
        body: inside
          ? `The crew is inside a regional dust storm about ${across} across. Expect dim light, short views and less solar power.`
          : `A regional dust storm about ${across} across is centred ${fmtDistance(d)} to the ${compass(bearingDeg(crew.lon, crew.lat, ev.lon, ev.lat))}. Expect dimmer light and less solar power if it spreads.`,
        source: 'event',
        atUtcMs,
        position: [ev.lon, ev.lat],
        speak: 'Regional dust storm reported.',
      },
    };
  }
  // A solar particle event: a cabin can shelter its crew, anyone else heads back.
  const shelter = v.cabin;
  const dose = `The dose so far is ${crew.doseMSv.toFixed(2)} mSv.`;
  return {
    alert: {
      id: ev.id,
      severity: 'warning',
      title: 'Solar particle event',
      body: shelter
        ? `A solar particle event is under way. Move to the most shielded part of the cabin. ${dose}`
        : `A solar particle event is under way and ${v.crew > 0 ? 'suits stop little of it' : 'the electronics are exposed'}. Head back to shelter. ${dose}`,
      source: 'event',
      atUtcMs,
      position: [crew.lon, crew.lat],
      action: shelter ? { kind: 'shelter', label: 'Shelter in the cabin' } : { kind: 'turnBack', label: 'Turn back for shelter' },
      speak: shelter ? 'Solar particle event. Shelter in the cabin.' : 'Solar particle event. Turn back for shelter.',
    },
  };
}

/** Raise a scheduled event's alert, if it still applies. */
export function fireEvent(world: World, ev: ScheduledEvent, atUtcMs: number): World {
  const run = world.run;
  if (!run || run.status !== 'running') return world;
  const out = eventAlert(run, ev, atUtcMs);
  return out ? raiseAlert(world, out.alert, out.hazard) : world;
}

/** Put an event in right now, ahead of the crew: for tests and the demo console. */
export function forceEvent(world: World, kind: EventKind): World {
  const run = world.run;
  if (!run || run.status !== 'running') return world;
  const crew = crewAt(run, world.utcMs);
  const [r, rng] = draws(world.rng, 3);
  const w: World = { ...world, rng, seq: world.seq + 1 };
  const id = `${kind === 'dustDevil' ? 'dust' : kind}:forced:${w.seq}`;
  let ev: ScheduledEvent;
  if (kind === 'dustDevil') {
    const tl = timelineOf(run);
    const left = (tl.along[tl.along.length - 1] ?? 0) - crew.distM;
    if (left < 50) return world;
    const near = crew.distM + Math.min(DEVIL_WARNING_M, left * 0.6);
    const clear = clearDevilNear(run, near, crew.distM + 100, crew.distM + left - 50, [r[0] ?? 0.5, r[1] ?? 0.5], id);
    if (!clear) return world;
    ev = clear;
  } else if (kind === 'storm') {
    const s = run.scenario.storm;
    if (s) ev = { id, kind, atUtcMs: world.utcMs, lon: s.lon, lat: s.lat, radiusM: s.radiusKm * 1000 };
    else {
      // No storm in the scenario: a demo storm 150 to 250 km off in a random direction, 600 km across.
      const [lon, lat] = destination(crew.lon, crew.lat, (r[0] ?? 0) * 360, 150_000 + (r[1] ?? 0.5) * 100_000);
      ev = { id, kind, atUtcMs: world.utcMs, lon, lat, radiusM: 300_000 };
    }
  } else {
    ev = { id, kind, atUtcMs: world.utcMs };
  }
  return fireEvent(w, { ...ev, atUtcMs: world.utcMs }, world.utcMs);
}

