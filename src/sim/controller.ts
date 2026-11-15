/**
 * The bridge between the pure simulation and the app: it owns the tick, keeps the world in the store,
 * drives the app clock from the mission clock, and asks the router when an alert proposes a new route.
 */
import { peopleOf } from '@/engines/fleet';
import { toast } from 'sonner';
import { computeTrip } from '@/engines/tripComputer';
import { missionById } from '@/engines/missions';
import type { PathPoint, TripStop } from '@/engines/types';
import { pathStats } from '@/planner/geometry';
import { VEHICLES } from '@/engines/vehicles';
import { distanceM } from '@/lib/geo';
import { routeOnce } from '@/planner/single';
import { startProblem } from '@/planner/startCheck';
import { useApp } from '@/store';
import { forceEvent } from './events';
import type { EventKind, Speed, World } from './types';
import { abortMission, adoptRoute, answerPending, applyAlert, createWorld, crewAt, ignoreAlert, proposal, say, setPaused, setSpeed, startMission as startRun, tick } from './world';

const TICK_MS = 100;
/** The most real time made up in one go after the tab was in the background, s. */
const MAX_CATCH_UP_S = 90;
let timer = 0;
let lastTick = 0;
/** When a question to the base began waiting on a clock that stands still (performance.now()), else 0. */
let heldSince = 0;
let spoken = new Set<string>();
// Counts missions started: a reply to a route asked for one mission must never land on the next.
let missionSerial = 0;
// Set while the world shown is another browser's run (a crew member watching the commander's): the levers
// below then do nothing, since the next snapshot would undo them anyway.
let mirror = false;

/** Marks the world in the store as someone else's run, or as this browser's own again. */
export function setMirror(on: boolean): void {
  mirror = on;
  if (on) stopTimer();
}

const world = (): World | null => useApp.getState().world;
function put(next: World | null): void {
  useApp.setState(next ? { world: next, utcMs: next.utcMs } : { world: null });
}

function speak(w: World): void {
  if (!useApp.getState().spokenAlerts || typeof speechSynthesis === 'undefined') return;
  for (const alert of w.alerts) {
    if (spoken.has(alert.id) || !alert.speak) continue;
    spoken.add(alert.id);
    speechSynthesis.speak(new SpeechSynthesisUtterance(alert.speak));
  }
}

function loop(): void {
  const now = performance.now();
  // A tab in the background gets its timer a second, or even a minute, apart; the time missed is made up below.
  let dt = Math.min(MAX_CATCH_UP_S, (now - lastTick) / 1000);
  lastTick = now;
  const w = world();
  if (!w?.run) return stopTimer();
  // A proposal whose alert has gone (answered, expired, another mission) must not hold the clock for ever.
  const pending = useApp.getState().proposed;
  if (pending && (w.run.status !== 'running' || !w.alerts.some((a) => a.id === pending.alertId && !a.resolved))) useApp.setState({ proposed: null });
  if (!clockTicking(w)) {
    // The base answers a question asked while the clock stands still, after a moment of the visitor's own time.
    if (w.run.status === 'running' && w.pendingReplies.length > 0) {
      if (heldSince === 0) heldSince = now;
      else if (now - heldSince >= 3000) {
        heldSince = 0;
        put(answerPending(w));
      }
    } else heldSince = 0;
    return;
  }
  heldSince = 0;
  // In steps of at most a second, stopping where the clock would stop (a warning that wants a decision), so a
  // commander's hidden tab keeps the crew moving for everyone without carrying them past a choice.
  let next = w;
  while (dt > 1e-6) {
    const step = Math.min(1, dt);
    next = tick(next, step);
    dt -= step;
    if (!clockTicking(next)) break;
  }
  put(next);
  speak(next);
}

/**
 * Whether the mission clock is moving. It stands still while paused or over, while a new route is worked out or
 * weighed, and while a warning that asks for a decision is unanswered: at 100x it would be past before it was read.
 */
export function clockTicking(w: World | null = world()): boolean {
  if (!w?.run || w.paused || w.run.status !== 'running') return false;
  const s = useApp.getState();
  if (s.routingAlertId !== null || s.proposed !== null) return false;
  return !w.alerts.some((a) => !a.resolved && a.severity === 'warning' && a.action);
}

function stopTimer(): void {
  if (timer) window.clearInterval(timer);
  timer = 0;
}

/** Starts the selected route as a mission. The app clock follows the mission from here. */
export function startMission(): boolean {
  const s = useApp.getState();
  // One mission at a time, and only a plan that works: whichever button asked, the same check decides.
  const problem = startProblem(s);
  if (problem) {
    toast('The mission cannot start yet', { description: problem });
    return false;
  }
  // startProblem has already ruled these out; this only narrows the types.
  if (s.route.status !== 'ready' || !s.plan.start) return false;
  const { alternatives, selected, departUtcMs } = s.route;
  const route = alternatives.find((a) => a.id === selected) ?? alternatives[0];
  if (!route) return false;
  const name = (s.missionId ? missionById(s.missionId)?.title : undefined) ?? 'Mission';
  // A seed from the plan, so the same plan meets the same events: a demo can be rehearsed.
  const seed = Math.abs(Math.round(route.trip.totals.distM * 7 + route.path.length * 13)) || 1;
  const started = startRun(createWorld(departUtcMs, seed), { name, plan: s.plan, path: [...route.path], stopIndices: [...route.stopIndices], trip: route.trip, scenario: s.scenario }, departUtcMs);
  if (!started.run) return false;
  if (s.missionId) started.run.missionId = s.missionId;
  // A run of this browser's own: whatever was being watched before is over.
  mirror = false;
  spoken = new Set();
  missionSerial += 1;
  useApp.setState({ world: started, utcMs: started.utcMs, clockLive: false, clockPaused: true, proposed: null, routingAlertId: null, plannerOpen: false, placeId: null, picking: null });
  lastTick = performance.now();
  stopTimer();
  timer = window.setInterval(loop, TICK_MS);
  return true;
}

/**
 * Takes up a run that was going on before this page loaded (the commander's browser after a reload, rebuilt
 * from the crew server's last snapshot) and keeps it ticking from where it was.
 */
export function resumeMission(next: World): boolean {
  if (!next.run || mirror) return false;
  // Alerts already raised were spoken before the reload.
  spoken = new Set(next.alerts.map((a) => a.id));
  missionSerial += 1;
  useApp.setState({ world: next, utcMs: next.utcMs, clockLive: false, clockPaused: true, proposed: null, routingAlertId: null, plannerOpen: false, picking: null });
  lastTick = performance.now();
  stopTimer();
  if (next.run.status === 'running') timer = window.setInterval(loop, TICK_MS);
  return true;
}

/** Ends the mission, if one is running, and gives the clock back to real time. */
export function closeMission(): void {
  stopTimer();
  mirror = false;
  missionSerial += 1;
  useApp.setState({ world: null, proposed: null, routingAlertId: null, utcMs: Date.now(), clockLive: true, clockPaused: false });
}

export function abortRun(): void {
  const w = world();
  if (!w || mirror) return;
  // A new route for a mission that is over is nobody's to take.
  useApp.setState({ proposed: null, routingAlertId: null });
  put(abortMission(w));
}

export function setRunSpeed(speed: Speed): void {
  const w = world();
  if (w && !mirror) put(setSpeed(w, speed));
}

export function toggleRunPaused(): void {
  const w = world();
  if (!w || mirror) return;
  lastTick = performance.now();
  put(setPaused(w, !w.paused));
}

export function sayToBase(text: string): void {
  const w = world();
  const line = text.trim().slice(0, 400);
  if (w && line) put(say(w, line));
}

export function ignore(alertId: string): void {
  const w = world();
  if (w && !mirror) put(ignoreAlert(w, alertId));
}

/** Puts an event in front of the crew right now. For the demo console and the tests. */
export function forceRunEvent(kind: EventKind): void {
  const w = world();
  if (w?.run) put(forceEvent(w, kind));
}

/**
 * Acts on an alert. One that only asks the crew to do something is applied at once. One that proposes
 * a new route is worked out first and shown on the map; the crew then takes it or keeps the old one.
 */
export async function apply(alertId: string): Promise<void> {
  const w = world();
  const alert = w?.alerts.find((a) => a.id === alertId);
  if (mirror || !w?.run || !alert?.action || alert.resolved) return;
  if (alert.action.kind !== 'reroute' && alert.action.kind !== 'turnBack') return put(applyAlert(w, alertId));

  const ask = proposal(w, alertId);
  if (!ask || ask.via.length === 0) return put(ignoreAlert(w, alertId));
  useApp.setState({ routingAlertId: alertId });
  const serial = missionSerial;
  try {
    const run = w.run;
    const path: PathPoint[] = [];
    const stopIndices = [0];
    const stops: TripStop[] = [];
    let from = ask.from;
    for (const via of ask.via) {
      // The crew is standing at this stop (working there): the leg is the spot itself, with the work left.
      if (distanceM(from[0], from[1], via.lon, via.lat) < 15 && via.elev !== undefined) {
        const at: PathPoint = [via.lon, via.lat, via.elev];
        if (path.length === 0) path.push([from[0], from[1], via.elev]);
        path.push(at);
        const index = path.length - 1;
        stopIndices.push(index);
        const workMin = run.tasks.filter((t) => t.stopId === via.stopId && t.state !== 'done' && t.state !== 'skipped').reduce((n, t) => n + t.minutes, 0);
        if (workMin > 0) stops.push({ index, workMin, ...(via.name ? { name: via.name } : {}) });
        from = [via.lon, via.lat];
        continue;
      }
      const reply = await routeOnce({ from, to: [via.lon, via.lat], vehicle: ask.vehicle, style: run.plan.style, departUtcMs: ask.departUtcMs, scenario: run.scenario, hazards: ask.hazards });
      if (!reply.ok) {
        toast('No way round was found', { description: `${reply.message} The crew stays on the route it has.` });
        return;
      }
      // The first point of a leg repeats the last point of the one before it.
      for (const p of path.length > 0 ? reply.path.slice(1) : reply.path) path.push(p);
      const index = path.length - 1;
      stopIndices.push(index);
      // Work still to do at this stop: tasks not yet done there.
      const workMin = run.tasks.filter((t) => t.stopId === via.stopId && t.state !== 'done' && t.state !== 'skipped').reduce((n, t) => n + t.minutes, 0);
      if (workMin > 0) stops.push({ index, workMin, ...(via.name ? { name: via.name } : {}) });
      from = [via.lon, via.lat];
    }
    const now = world();
    // The mission may have ended, or another begun, while the router worked.
    if (serial !== missionSerial || !now?.run || now.run.status !== 'running' || !now.alerts.some((a) => a.id === alertId && !a.resolved)) return;
    // What the change costs, against what was left of the old route; costed from what the crew has left now.
    const crew = crewAt(run, now.utcMs);
    const trip = computeTrip(path, {
      vehicle: ask.vehicle,
      people: peopleOf(run.plan),
      departUtcMs: now.utcMs,
      scenario: run.scenario,
      style: run.plan.style,
      stops,
      campAtNight: run.plan.campAtNight,
      ...(crew.o2Kg !== null ? { startO2Kg: crew.o2Kg } : {}),
      ...(crew.batteryKWh !== null ? { startBatteryKWh: crew.batteryKWh } : {}),
      // Suits worn since the mission set out: what they have left is what the new route can count on.
      ...(VEHICLES[ask.vehicle].cabin ? {} : { startSuitS: Math.max(0, (now.utcMs - run.startedUtcMs) / 1000) }),
      // The new leg starts where the crew is, not at home: only carrying on reaches home, and only if home is ahead.
      homeAt: ask.homeIsAhead ? 'end' : 'none',
    });
    const oldLeftM = Math.max(0, pathStats(run.path).distM - crew.distM);
    const oldLeftS = Math.max(0, (run.legStartUtcMs + run.trip.totals.durationS * 1000 - now.utcMs) / 1000);
    useApp.setState({ proposed: { alertId, path, stopIndices, trip, addedM: trip.totals.distM - oldLeftM, addedS: run.trip.samples.length > 0 ? trip.totals.durationS - oldLeftS : 0 } });
  } catch {
    toast('The new route could not be worked out', { description: 'The crew stays on the route it has.' });
  } finally {
    if (serial === missionSerial) useApp.setState({ routingAlertId: null });
    lastTick = performance.now();
  }
}

/** The crew takes the proposed route. */
export function takeProposed(): void {
  const { proposed } = useApp.getState();
  const w = world();
  if (!proposed || !w || mirror) return;
  lastTick = performance.now();
  useApp.setState({ proposed: null });
  put(adoptRoute(w, proposed.alertId, { path: proposed.path, stopIndices: proposed.stopIndices, trip: proposed.trip }));
}

/** The crew keeps the route it has; the alert stays open to be ignored or tried again. */
export function dropProposed(): void {
  lastTick = performance.now();
  useApp.setState({ proposed: null });
}

declare global {
  interface Window {
    /** The running mission's levers, for the demo console and the tests. */
    __areoSim?: { start: typeof startMission; force: typeof forceRunEvent; speed: typeof setRunSpeed };
  }
}
if (typeof window !== 'undefined') window.__areoSim = { start: startMission, force: forceRunEvent, speed: setRunSpeed };
