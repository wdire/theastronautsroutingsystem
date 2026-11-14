/**
 * The mission the visitor is crew of, kept in step with the server: who is on it (the roster the 3D view draws),
 * its crew log, and its plan, which flows from the commander's planner to everyone else's.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import { toast } from 'sonner';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SUIT_COLOR_HEX } from '../../convex/shared';
import type { FunctionReturnType } from 'convex/server';
import type { MissionPlan } from '@/engines/types';
import { useApp, type RosterMember } from '@/store';
import { auth, convex, toastError } from './client';
import { createDebounce, encodePlan, parsePlan, PLAN_DEBOUNCE_MS, samePlan } from './planSync';
import { planLocked, useCrew, type CrewLogEntry } from './state';

export type MissionData = NonNullable<FunctionReturnType<typeof api.missions.get>>;
export type CrewRow = MissionData['crew'][number];

/** The joined crew in walking order, as the 3D view wants it. */
export function rosterOf(crew: readonly CrewRow[], myClientId: string): RosterMember[] {
  return crew
    .filter((c) => c.state === 'joined')
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c._id, name: c.name, role: c.role, color: SUIT_COLOR_HEX[c.color], android: c.kind === 'android', me: c.personId === myClientId }));
}

function sameRoster(a: readonly RosterMember[] | null, b: readonly RosterMember[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]));
}

/**
 * Follows the visitor's mission: the current one, or the one that just ended under them so its end card and
 * debrief stay at hand. Fills useCrew.current, useCrew.ended and the store's roster.
 */
export function useCurrentMission(registered: boolean): MissionData | null {
  const me = auth();
  const mine = useQuery(api.missions.mine, registered ? me : 'skip');
  const ended = useCrew((s) => s.ended);
  const currentId = mine?.current ?? null;
  const followId = currentId ?? ended;
  const data = useQuery(api.missions.get, followId ? { missionId: followId, ...me } : 'skip') ?? null;
  const last = useRef<{ id: Id<'missions'>; ran: boolean } | null>(null);

  useEffect(() => {
    if (mine === undefined) return;
    const prev = last.current;
    if (currentId && data && data.mission._id === currentId) {
      const ran = data.mission.startedAt !== null;
      last.current = { id: currentId, ran };
      useCrew.setState((s) => ({
        current: { id: currentId, title: data.mission.title, status: data.mission.status, isCommander: data.isCommander },
        ended: s.ended === currentId ? s.ended : null,
      }));
    } else if (!currentId) {
      // A run that ended under the visitor stays followed until they put it away; leaving or a cancelled plan does not.
      if (prev?.ran) useCrew.setState({ ended: prev.id });
      last.current = null;
      useCrew.setState({ current: null });
    }
  }, [mine, currentId, data]);

  const myId = me.clientId;
  useEffect(() => {
    const roster = currentId && data && data.mission._id === currentId ? rosterOf(data.crew, myId) : null;
    if (!sameRoster(useApp.getState().roster, roster)) useApp.setState({ roster });
  }, [currentId, data, myId]);

  return data;
}

/** The crew log of the followed mission, into useCrew, and the radio to write to it. */
export function useCrewLog(missionId: Id<'missions'> | null, canWrite: boolean): void {
  const log = useQuery(api.log.list, missionId ? { auth: auth(), missionId } : 'skip');
  useEffect(() => {
    const entries: CrewLogEntry[] = (log ?? []).map((e) => ({ id: e._id, authorId: e.authorId, authorName: e.authorName, kind: e.kind, text: e.text, missionUtcMs: e.missionUtcMs, createdAt: e.createdAt }));
    useCrew.setState({ log: entries });
  }, [log]);

  useEffect(() => {
    if (!missionId || !canWrite || !convex) {
      useCrew.setState({ radio: null });
      return;
    }
    const client = convex;
    useCrew.setState({
      radio: (text: string) => {
        const line = text.trim().slice(0, 1000);
        if (!line) return;
        const utc = useApp.getState().world?.utcMs;
        client.mutation(api.log.add, { auth: auth(), missionId, kind: 'radio', text: line, ...(utc !== undefined ? { missionUtcMs: utc } : {}) }).catch(toastError);
      },
    });
    return () => useCrew.setState({ radio: null });
  }, [missionId, canWrite]);
}

/** Set while the commander plans: sends a waiting plan edit at once, so Start never runs ahead of it. */
let flushPlan: (() => Promise<void>) | null = null;
export function flushPendingPlan(): Promise<void> {
  return flushPlan?.() ?? Promise.resolve();
}

function sharedNow(): string {
  const s = useApp.getState();
  return encodePlan({ plan: s.plan, templateId: s.missionId });
}

/**
 * The plan between the commander and the crew. The commander's edits go to the server after a pause; everyone
 * else loads each new revision and keeps their planner read-only. On the commander's first look at a mission
 * (a reload, say) the server's copy is loaded too, since it is the one the crew sees.
 */
export function usePlanSync(data: MissionData | null): void {
  const missionId = data?.mission._id ?? null;
  const planning = data?.mission.status === 'planning' && data.isCrew;
  const isCommander = data?.isCommander ?? false;
  const planRev = data?.mission.planRev ?? 0;
  const planJson = data?.mission.planJson ?? '';
  const plannedStartUtc = data?.mission.plannedStartUtc ?? null;
  const loadedFor = useRef<Id<'missions'> | null>(null);
  const synced = useRef<MissionPlan | null>(null);
  const syncedStart = useRef<number | null>(null);

  // Pull: load the server's plan and departure.
  useEffect(() => {
    if (!missionId || !planning) return;
    if (isCommander && loadedFor.current === missionId) return;
    const shared = parsePlan(planJson);
    if (!shared) return;
    synced.current = shared.plan;
    syncedStart.current = plannedStartUtc;
    loadedFor.current = missionId;
    const s = useApp.getState();
    if (!samePlan(s.plan, shared.plan)) s.setPlan(shared.plan, shared.templateId ?? undefined);
    // A departure the commander chose before creating the mission goes up with it, rather than being lost.
    if (isCommander && plannedStartUtc === null && s.departUtcMs !== null && convex) {
      convex.mutation(api.missions.update, { auth: auth(), missionId, plannedStartUtc: s.departUtcMs }).catch(toastError);
    } else if (s.departUtcMs !== plannedStartUtc) {
      s.setDepartUtcMs(plannedStartUtc);
    }
  }, [missionId, planning, isCommander, planRev, planJson, plannedStartUtc]);

  // Push: the commander's edits go out after a pause.
  useEffect(() => {
    if (!missionId || !planning || !isCommander || !convex) return;
    const client = convex;
    let lastSent = sharedNow();
    let sending: Promise<void> = Promise.resolve();
    const plan = createDebounce<string>(PLAN_DEBOUNCE_MS, (json) => {
      const vehicle = useApp.getState().plan.vehicle;
      sending = client
        .mutation(api.missions.setPlan, { auth: auth(), missionId, planJson: json, vehicle })
        .then(() => {
          lastSent = json;
        })
        .catch(toastError);
    });
    const depart = createDebounce<number | null>(PLAN_DEBOUNCE_MS, (t) => {
      client.mutation(api.missions.update, { auth: auth(), missionId, plannedStartUtc: t }).catch(toastError);
    });
    const offPlan = useApp.subscribe(
      (s) => s.plan,
      () => {
        const json = sharedNow();
        if (json !== lastSent) plan.push(json);
      },
    );
    const offDepart = useApp.subscribe((s) => s.departUtcMs, (t) => depart.push(t));
    flushPlan = async () => {
      plan.flush();
      depart.flush();
      await sending;
    };
    return () => {
      offPlan();
      offDepart();
      plan.cancel();
      depart.cancel();
      flushPlan = null;
    };
  }, [missionId, planning, isCommander]);

  // Guard: a member's planner is read-only. Edits from the map (a dragged pin, a click on the route) are undone.
  const locked = useCrew(planLocked);
  useEffect(() => {
    if (!locked) return;
    let told = 0;
    const tell = () => {
      if (Date.now() - told < 4000) return;
      told = Date.now();
      toast('The commander plans the route.');
    };
    const offPlan = useApp.subscribe(
      (s) => s.plan,
      (plan) => {
        const back = synced.current;
        if (back && !samePlan(plan, back)) {
          useApp.setState((s) => ({ plan: back, planRev: s.planRev + 1 }));
          tell();
        }
      },
    );
    const offPick = useApp.subscribe(
      (s) => s.picking,
      (p) => {
        if (p === 'start' || p === 'stop') useApp.setState({ picking: null });
      },
    );
    const offDepart = useApp.subscribe(
      (s) => s.departUtcMs,
      (t) => {
        if (t !== syncedStart.current) useApp.setState({ departUtcMs: syncedStart.current });
      },
    );
    return () => {
      offPlan();
      offPick();
      offDepart();
    };
  }, [locked]);
}
