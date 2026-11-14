/**
 * The bridge between the pure simulation and the app: it owns the tick, keeps the world in the store,
 * drives the app clock from the mission clock, and asks the router when an alert proposes a new route.
 */
import { toast } from 'sonner';
import { computeTrip } from '@/engines/tripComputer';
import { missionById } from '@/engines/missions';
import type { PathPoint, TripStop } from '@/engines/types';
import { pathStats } from '@/planner/geometry';
import { routeOnce } from '@/planner/single';
import { useApp } from '@/store';
import { forceEvent } from './events';
import type { EventKind, Speed, World } from './types';
import { abortMission, adoptRoute, applyAlert, createWorld, crewAt, ignoreAlert, proposal, say, setPaused, setSpeed, startMission as startRun, tick } from './world';

const TICK_MS = 100;
let timer = 0;
let lastTick = 0;
let spoken = new Set<string>();
// Counts missions started: a reply to a route asked for one mission must never land on the next.
let missionSerial = 0;

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
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  const w = world();
  if (!w?.run) return stopTimer();
  // A proposal whose alert has gone (answered, expired, another mission) must not hold the clock for ever.
  const pending = useApp.getState().proposed;
  if (pending && (w.run.status !== 'running' || !w.alerts.some((a) => a.id === pending.alertId && !a.resolved))) useApp.setState({ proposed: null });
  // While a new route is being worked out or weighed, the crew waits where it is.
  // So does it while a warning that asks for a decision is unanswered: at 100x it would be past before it was read.
  const held = useApp.getState().routingAlertId !== null || useApp.getState().proposed !== null || w.alerts.some((a) => !a.resolved && a.severity === 'warning' && a.action);
  if (w.paused || held || w.run.status !== 'running') return;
  const next = tick(w, dt);
  put(next);
  speak(next);
}

function stopTimer(): void {
  if (timer) window.clearInterval(timer);
  timer = 0;
}

/** Starts the selected route as a mission. The app clock follows the mission from here. */
export function startMission(): boolean {
  const s = useApp.getState();
  // One mission at a time: a running one is ended by its own controls, never replaced by a stray Start.
  if (s.world?.run?.status === 'running') return false;
  if (s.route.status !== 'ready' || !s.plan.start) return false;
  const { alternatives, selected, departUtcMs } = s.route;
  const route = alternatives.find((a) => a.id === selected) ?? alternatives[0];
  if (!route) return false;
  const name = (s.missionId ? missionById(s.missionId)?.title : undefined) ?? 'Mission';
  // A seed from the plan, so the same plan meets the same events: a demo can be rehearsed.
  const seed = Math.abs(Math.round(route.trip.totals.distM * 7 + route.path.length * 13)) || 1;
  const started = startRun(createWorld(departUtcMs, seed), { name, plan: s.plan, path: [...route.path], stopIndices: [...route.stopIndices], trip: route.trip, scenario: s.scenario }, departUtcMs);
  if (!started.run) return false;
  spoken = new Set();
  missionSerial += 1;
  useApp.setState({ world: started, utcMs: started.utcMs, clockLive: false, clockPaused: true, proposed: null, routingAlertId: null, plannerOpen: false, placeId: null, picking: null });
  lastTick = performance.now();
  stopTimer();
  timer = window.setInterval(loop, TICK_MS);
  return true;
}

/** Ends the mission, if one is running, and gives the clock back to real time. */
export function closeMission(): void {
  stopTimer();
  missionSerial += 1;
  useApp.setState({ world: null, proposed: null, routingAlertId: null, utcMs: Date.now(), clockLive: true, clockPaused: false });
}

export function abortRun(): void {
  const w = world();
  if (!w) return;
  // A new route for a mission that is over is nobody's to take.
  useApp.setState({ proposed: null, routingAlertId: null });
  put(abortMission(w));
}

export function setRunSpeed(speed: Speed): void {
  const w = world();
  if (w) put(setSpeed(w, speed));
}

export function toggleRunPaused(): void {
  const w = world();
  if (!w) return;
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
  if (w) put(ignoreAlert(w, alertId));
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
  if (!w?.run || !alert?.action || alert.resolved) return;
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
    const trip = computeTrip(path, { vehicle: ask.vehicle, departUtcMs: now.utcMs, scenario: run.scenario, style: run.plan.style, stops, campAtNight: run.plan.campAtNight });
    // What the change costs, against what was left of the old route.
    const crew = crewAt(run, now.utcMs);
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
  if (!proposed || !w) return;
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
