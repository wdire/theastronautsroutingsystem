/**
 * The run between browsers. The commander's browser owns the world, as it does solo: it ticks the simulation,
 * publishes a snapshot at most once a second (and every few seconds while nothing moves, so the crew knows the
 * link is up), sends the route only when it changes, writes run events to the crew log and files the debrief at
 * the end. Every other crew member rebuilds the world from what was published and only watches.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { assigneeWords, LIMITS, SUIT_COLOR_HEX, type CrewColor } from '../../convex/shared';
import { stopLabel } from '@/planner/labels';
import { clockTicking, closeMission, resumeMission, sayToBase, setMirror, startMission } from '@/sim/controller';
import type { World } from '@/sim/types';
import { useApp } from '@/store';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { auth, convex, errorText, toastError } from './client';
import { buildDebrief } from './debrief';
import { runEvents } from './events';
import { flushPendingPlan, type MissionData } from './mission';
import { encodeRoute, encodeSnapshot, parseRoute, parseSnapshot, plannedFrom, rebuildWorld, routeOf, type Planned, type RouteDoc } from './snapshot';
import { followClock, type ClockAnchor } from './smoothClock';
import { useCrew } from './state';
import { baseQuestion } from './words';
import { toast } from 'sonner';

const PUBLISH_MS = 1000;
const KEEPALIVE_MS = 5000;
/** A member calls the link lost when the commander's browser has been silent this long. */
export const STALE_MS = 15_000;

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

// What the route promised when the mission set out, by mission; also carried in every snapshot.
const plannedFor = new Map<string, Planned>();

/** Starts the mission for the whole crew: the local run first, then the server, which tells everyone. */
export async function startCrewMission(missionId: Id<'missions'>): Promise<boolean> {
  if (!convex) return false;
  await flushPendingPlan();
  if (!startMission()) return false;
  const world = useApp.getState().world;
  const run = world?.run;
  if (!world || !run) return false;
  const planned = plannedFrom(run.trip, run.startedUtcMs, run.startLevels);
  const routeJson = encodeRoute(routeOf(run));
  const snapshotJson = encodeSnapshot(world, planned, clockTicking(world));
  if (bytes(routeJson) > LIMITS.routeBytes || bytes(snapshotJson) > LIMITS.snapshotBytes) {
    closeMission();
    toast('This route is too long to share with the crew. Shorten it or split it into two missions.');
    return false;
  }
  try {
    await convex.mutation(api.missions.start, { auth: auth(), missionId, routeJson, snapshotJson });
  } catch (err) {
    closeMission();
    toastError(err);
    return false;
  }
  plannedFor.set(missionId, planned);
  const stops = run.plan.stops.length;
  const from = run.plan.start ? stopLabel(run.plan.start) : 'the start';
  void convex
    .mutation(api.log.addSystem, {
      auth: auth(),
      missionId,
      text: `Set out from ${from}: ${stops} ${stops === 1 ? 'stop' : 'stops'}, ${fmtDistance(run.trip.totals.distM)}, about ${fmtDuration(run.trip.totals.durationS)}.`,
      missionUtcMs: run.startedUtcMs,
    })
    .catch(() => {});
  return true;
}

/** The live snapshot and route of a mission, joined into a world, while `enabled`. */
function useLiveWorld(missionId: Id<'missions'> | null, enabled: boolean) {
  const live = useQuery(api.missions.live, enabled && missionId ? { auth: auth(), missionId } : 'skip');
  const route = useQuery(api.missions.route, enabled && missionId && live ? { auth: auth(), missionId, routeRev: live.routeRev } : 'skip');
  // A new route revision answers undefined until it arrives; the last good route carries on until then.
  const parsed = useMemo(() => (route ? parseRoute(route.routeJson) : null), [route]);
  const [kept, setKept] = useState<{ rev: number; doc: RouteDoc } | null>(null);
  if (parsed && route && kept?.rev !== route.routeRev) setKept({ rev: route.routeRev, doc: parsed });
  const routeDoc = parsed ?? kept?.doc ?? null;
  const snapshot = useMemo(() => (live ? parseSnapshot(live.snapshotJson) : null), [live]);
  const world = useMemo(() => (snapshot ? rebuildWorld(snapshot, routeDoc) : null), [snapshot, routeDoc]);
  return { world, planned: snapshot?.planned ?? null, ticking: snapshot?.ticking ?? null, updatedAt: live?.updatedAt ?? null, hasLive: live !== undefined && live !== null };
}

/**
 * Missions whose end this browser is filing (or has filed). The server says "underway" until the filing lands,
 * a second or more after the end; a run put away in that window must not be resumed from its last snapshot,
 * nor filed twice.
 */
const finishing = new Set<string>();

/** The commander's side: publish, log, relay the crew's radio calls to the base, and file the debrief. */
export function useCommanderRun(data: MissionData | null): void {
  const missionId = data?.mission._id ?? null;
  const underway = data?.mission.status === 'underway' && data.isCommander;
  const hasWorld = useApp((s) => s.world?.run != null);

  // After a reload the world is gone from this browser; it is rebuilt from the last snapshot and ticks on.
  const resume = useLiveWorld(missionId, underway && !hasWorld);
  useEffect(() => {
    if (!underway || hasWorld || !resume.world || !missionId) return;
    if (finishing.has(missionId) || resume.world.run?.status !== 'running') return;
    if (resume.planned) plannedFor.set(missionId, resume.planned);
    resumeMission(resume.world);
  }, [underway, hasWorld, resume.world, resume.planned, missionId]);

  // The crew and assignments change rarely; the publisher reads them from a ref, so it does not restart.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!underway || !hasWorld || !missionId || !convex) return;
    const client = convex;
    let prev: World | null = useApp.getState().world;
    let publishedLeg = prev?.run?.leg ?? 0;
    let lastPublish = 0;
    let inFlight = false;
    let finished = false;
    // A change of pace (pause, speed, a held clock, the end) goes out at once: members run their own clock on
    // from the last snapshot, and would run on wrongly until the next.
    const stateKey = (w: World) => `${w.paused}:${w.speed}:${w.run?.status}:${clockTicking(w)}:${w.run?.leg}`;
    let lastState = prev ? stateKey(prev) : '';
    let changed = false;
    const pendingLogs: Promise<unknown>[] = [];

    const assigneeOf = (taskId: string): string | null => {
      const d = dataRef.current;
      return d ? assigneeWords(d.mission.assignments[taskId], (id) => d.crew.find((c) => c._id === id)?.name) : null;
    };

    const publish = async (): Promise<void> => {
      const w = useApp.getState().world;
      if (!w?.run || finished) return;
      if (inFlight) {
        changed = true;
        return;
      }
      inFlight = true;
      lastPublish = Date.now();
      const leg = w.run.leg;
      const planned = plannedFor.get(missionId) ?? null;
      lastState = stateKey(w);
      try {
        await client.mutation(api.missions.publish, {
          auth: auth(),
          missionId,
          snapshotJson: encodeSnapshot(w, planned, clockTicking(w)),
          ...(leg !== publishedLeg ? { routeJson: encodeRoute(routeOf(w.run)) } : {}),
        });
        publishedLeg = leg;
      } catch (err) {
        // The next tick tries again; say so only when the server refuses, not when the link drops for a moment.
        if (errorText(err) !== errorText(null)) toastError(err);
      } finally {
        inFlight = false;
      }
    };

    const finish = async (w: World): Promise<void> => {
      if (finishing.has(missionId)) return;
      finishing.add(missionId);
      // The last snapshot shows the crew the end; after it nothing more is published.
      for (let i = 0; inFlight && i < 50; i++) await new Promise((r) => window.setTimeout(r, 100));
      await publish();
      finished = true;
      // Run events just written should make it into the debrief's copy of the log.
      await Promise.allSettled(pendingLogs);
      await new Promise((r) => window.setTimeout(r, 1200));
      const d = dataRef.current;
      if (!d) return;
      const debrief = buildDebrief({
        mission: { title: d.mission.title, objective: d.mission.objective, vehicle: d.mission.vehicle, siteName: d.mission.siteName, plannedStartUtc: d.mission.plannedStartUtc },
        crew: d.crew,
        assignments: d.mission.assignments,
        world: w,
        planned: plannedFor.get(missionId) ?? null,
        log: useCrew.getState().log.map((l) => ({ authorName: l.authorName, kind: l.kind, text: l.text, missionUtcMs: l.missionUtcMs })),
        colorOf: (c) => SUIT_COLOR_HEX[c as CrewColor] ?? SUIT_COLOR_HEX.graphite,
        fallbackLon: w.run?.home[0] ?? 0,
      });
      try {
        await client.mutation(api.missions.finish, { auth: auth(), missionId, status: w.run?.status === 'aborted' ? 'aborted' : 'complete', debriefJson: JSON.stringify(debrief) });
      } catch (err) {
        toastError(err);
      }
    };

    const off = useApp.subscribe(
      (s) => s.world,
      (next) => {
        if (!next?.run || finished) return;
        for (const e of runEvents(prev, next, assigneeOf)) {
          pendingLogs.push(client.mutation(api.log.addSystem, { auth: auth(), missionId, text: e.text, missionUtcMs: e.missionUtcMs, ...(e.taskId ? { taskId: e.taskId } : {}) }).catch(() => {}));
        }
        const ended = prev?.run?.status === 'running' && next.run.status !== 'running';
        prev = next;
        if (ended) void finish(next);
        else if (stateKey(next) !== lastState || Date.now() - lastPublish >= PUBLISH_MS) void publish();
        else changed = true;
      },
    );
    // A change that came too soon after the last snapshot goes in the next one, a moment later, never dropped.
    // A held clock (a proposal on screen) changes no world, so its start and end are watched here too.
    const keepAlive = window.setInterval(() => {
      const w = useApp.getState().world;
      const since = Date.now() - lastPublish;
      if ((w && stateKey(w) !== lastState) || (changed && since >= PUBLISH_MS) || since >= KEEPALIVE_MS) {
        changed = false;
        void publish();
      }
    }, 250);

    // Crew calls addressed "@Base" go to the simulated base, so it answers whoever asked; the rest is crew talk.
    // Calls already in the log are not replayed.
    const relayed = new Set(useCrew.getState().log.map((l) => l.id));
    const offLog = useCrew.subscribe((s) => {
      for (const l of s.log) {
        if (relayed.has(l.id)) continue;
        relayed.add(l.id);
        const question = l.kind === 'radio' ? baseQuestion(l.text) : null;
        if (question && useApp.getState().world?.run?.status === 'running') sayToBase(question);
      }
    });

    // A run already over when this began (finished while the page was closed) still needs its debrief.
    const now = useApp.getState().world;
    if (now?.run && now.run.status !== 'running') void finish(now);

    return () => {
      off();
      offLog();
      window.clearInterval(keepAlive);
    };
  }, [underway, hasWorld, missionId]);
}

/** A member's side: the commander's world, rebuilt, in the store; and whether the link has gone quiet. */
export function useMemberRun(data: MissionData | null): void {
  const ended = useCrew((s) => s.ended);
  const missionId = data?.mission._id ?? null;
  const status = data?.mission.status;
  // Only crew watch: someone who left an underway mission is no longer on its radio or its screen.
  const watching = !!data && !data.isCommander && ((status === 'underway' && data.isCrew) || ((status === 'complete' || status === 'aborted') && ended === missionId && data.mission.startedAt !== null));
  const live = useLiveWorld(missionId, watching);
  const applied = useRef(false);
  // The latest snapshot's world and clock; the member's own clock runs on from it (src/net/smoothClock.ts).
  const latest = useRef<{ world: World; anchor: ClockAnchor } | null>(null);

  useEffect(() => {
    if (!watching || !live.world) return;
    const w = live.world;
    const ticking = live.ticking ?? clockTicking(w);
    latest.current = { world: w, anchor: { simUtcMs: w.utcMs, realMs: performance.now(), speed: w.speed, ticking } };
    if (!applied.current) {
      setMirror(true);
      applied.current = true;
      useApp.setState({ world: w, utcMs: w.utcMs, clockLive: false, clockPaused: true, proposed: null, routingAlertId: null, plannerOpen: false, picking: null });
      return;
    }
    // What the snapshot says (alerts, tasks, levels) shows at once; the clock carries on from where it was shown.
    const shown = useApp.getState().world?.utcMs ?? w.utcMs;
    const utcMs = followClock(shown, latest.current.anchor, performance.now(), 0);
    useApp.setState({ world: { ...w, utcMs }, utcMs });
  }, [watching, live.world, live.ticking]);

  // Ten times a second, as the commander's own tick: the crew moves on smoothly between snapshots.
  useEffect(() => {
    if (!watching) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1000, now - last);
      last = now;
      const cur = latest.current;
      const shown = useApp.getState().world;
      if (!cur || !shown?.run || shown.run.id !== cur.world.run?.id) return;
      const utcMs = followClock(shown.utcMs, cur.anchor, now, dt);
      if (utcMs !== shown.utcMs) useApp.setState({ world: { ...shown, utcMs }, utcMs });
    }, 100);
    return () => window.clearInterval(id);
  }, [watching]);

  // Stopped watching (left the crew, or put the ended run away): take the mirrored run off the screen.
  useEffect(() => {
    if (watching || !applied.current) return;
    applied.current = false;
    latest.current = null;
    closeMission();
  }, [watching]);

  // The link: fresh when a snapshot arrived in the last 15 s. The first one is judged by its server time.
  const freshAt = useRef(0);
  const updatedAt = live.updatedAt;
  useEffect(() => {
    if (updatedAt !== null) freshAt.current = freshAt.current === 0 ? Math.min(Date.now(), updatedAt) : Date.now();
  }, [updatedAt]);
  useEffect(() => {
    if (!watching || status !== 'underway') {
      useCrew.setState({ linkStale: false });
      return;
    }
    const check = () => {
      const stale = freshAt.current > 0 && Date.now() - freshAt.current > STALE_MS;
      if (useCrew.getState().linkStale !== stale) useCrew.setState({ linkStale: stale });
    };
    check();
    const id = window.setInterval(check, 2000);
    return () => window.clearInterval(id);
  }, [watching, status]);
}

