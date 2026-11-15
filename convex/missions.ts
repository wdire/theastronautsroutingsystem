/**
 * Missions: planning, the run and the debrief. The commander's browser runs the simulation and publishes
 * a snapshot here about once a second; everyone else just reads it. Plans and debriefs are opaque JSON.
 */
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { checkPerson, findPerson, isActive, requireCommander, requirePerson, requireStatus } from './lib/auth';
import { lastHere } from './lib/presence';
import * as check from './lib/check';
import { crewOut, crewOutV, crewRows, findRow, isCrewOf, releasePerson, requireFree, requireRow, systemLog } from './lib/crew';
import { authV, crewStateV, statusV } from './lib/validators';
import { COMMANDER_ROLE, dropCrewFrom, EVERYONE, LIMITS, MAX_CREW } from './shared';

const LIST_CAP = 50;
const HISTORY_CAP = 30;
const MAX_ASSIGNMENTS = 500;

type Ctx = QueryCtx | MutationCtx;

const missionOutV = v.object({
  _id: v.id('missions'),
  title: v.string(),
  objective: v.string(),
  commanderId: v.string(),
  status: statusV,
  plannedStartUtc: v.union(v.number(), v.null()),
  planJson: v.string(),
  planRev: v.number(),
  vehicle: v.string(),
  siteName: v.union(v.string(), v.null()),
  open: v.boolean(),
  createdAt: v.number(),
  startedAt: v.union(v.number(), v.null()),
  endedAt: v.union(v.number(), v.null()),
  assignments: v.record(v.string(), v.union(v.literal('all'), v.id('crew'), v.array(v.id('crew')))),
  debriefJson: v.union(v.string(), v.null()),
});

// One row per mission in each of these tables, looked up by the same index name.
/** How many vehicles in a shared plan need someone at the wheel. Unreadable plans count none. */
function crewedVehicles(planJson: string): number {
  try {
    const fleet: unknown = (JSON.parse(planJson) as { plan?: { fleet?: unknown } }).plan?.fleet;
    if (!Array.isArray(fleet)) return 0;
    let n = 0;
    for (const f of fleet as { vehicle?: unknown; count?: unknown }[]) {
      if ((f.vehicle === 'openRover' || f.vehicle === 'pressRover') && typeof f.count === 'number' && Number.isFinite(f.count)) n += Math.max(0, Math.round(f.count));
    }
    return n;
  } catch {
    return 0;
  }
}

const planOf = (ctx: Ctx, missionId: Id<'missions'>) => ctx.db.query('plans').withIndex('by_missionId', (q) => q.eq('missionId', missionId)).unique();
const debriefOf = (ctx: Ctx, missionId: Id<'missions'>) => ctx.db.query('debriefs').withIndex('by_missionId', (q) => q.eq('missionId', missionId)).unique();
const liveOf = (ctx: Ctx, missionId: Id<'missions'>) => ctx.db.query('live').withIndex('by_missionId', (q) => q.eq('missionId', missionId)).unique();
const routeOf = (ctx: Ctx, missionId: Id<'missions'>) => ctx.db.query('routes').withIndex('by_missionId', (q) => q.eq('missionId', missionId)).unique();

export const create = mutation({
  args: { auth: authV, title: v.string(), objective: v.string(), planJson: v.string(), vehicle: v.string(), siteName: v.optional(v.string()) },
  returns: v.id('missions'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const title = check.text(args.title, 'Title', 1, LIMITS.title);
    const objective = check.text(args.objective, 'Objective', 0, LIMITS.objective);
    const planJson = check.json(args.planJson, 'The plan', LIMITS.planBytes);
    const vehicle = check.text(args.vehicle, 'Vehicle', 1, LIMITS.vehicle);
    const siteName = args.siteName === undefined ? undefined : check.text(args.siteName, 'Site name', 0, LIMITS.siteName) || undefined;
    await requireFree(ctx, person);
    const now = Date.now();
    const missionId = await ctx.db.insert('missions', {
      title,
      objective,
      commanderId: person.clientId,
      status: 'planning',
      planRev: 1,
      vehicle,
      siteName,
      open: true,
      createdAt: now,
      assignments: {},
    });
    await ctx.db.insert('plans', { missionId, planJson });
    await ctx.db.insert('crew', {
      missionId,
      kind: 'human',
      personId: person.clientId,
      name: person.name,
      role: COMMANDER_ROLE,
      color: person.color,
      state: 'joined',
      joinedAt: now,
      order: 0,
    });
    await ctx.db.patch(person._id, { missionId });
    return missionId;
  },
});

export const update = mutation({
  args: {
    auth: authV,
    missionId: v.id('missions'),
    title: v.optional(v.string()),
    objective: v.optional(v.string()),
    plannedStartUtc: v.optional(v.union(v.number(), v.null())),
    open: v.optional(v.boolean()),
    vehicle: v.optional(v.string()),
    siteName: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning']);
    const patch: Partial<Doc<'missions'>> = {};
    if (args.title !== undefined) patch.title = check.text(args.title, 'Title', 1, LIMITS.title);
    if (args.objective !== undefined) patch.objective = check.text(args.objective, 'Objective', 0, LIMITS.objective);
    if (args.plannedStartUtc !== undefined) patch.plannedStartUtc = args.plannedStartUtc === null ? undefined : check.time(args.plannedStartUtc, 'Planned start');
    if (args.open !== undefined) patch.open = args.open;
    if (args.vehicle !== undefined) patch.vehicle = check.text(args.vehicle, 'Vehicle', 1, LIMITS.vehicle);
    if (args.siteName !== undefined) patch.siteName = args.siteName === null ? undefined : check.text(args.siteName, 'Site name', 0, LIMITS.siteName) || undefined;
    await ctx.db.patch(mission._id, patch);
    return null;
  },
});

export const setPlan = mutation({
  args: { auth: authV, missionId: v.id('missions'), planJson: v.string(), vehicle: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning']);
    const planJson = check.json(args.planJson, 'The plan', LIMITS.planBytes);
    const vehicle = check.text(args.vehicle, 'Vehicle', 1, LIMITS.vehicle);
    const plan = await planOf(ctx, mission._id);
    if (plan) await ctx.db.patch(plan._id, { planJson });
    else await ctx.db.insert('plans', { missionId: mission._id, planJson });
    const planRev = mission.planRev + 1;
    await ctx.db.patch(mission._id, { planRev, vehicle });
    return planRev;
  },
});

export const assign = mutation({
  // Who does a task: nobody (null), the whole crew ('all'), or the crew members listed.
  args: { auth: authV, missionId: v.id('missions'), taskId: v.string(), to: v.union(v.null(), v.literal('all'), v.array(v.id('crew'))) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning', 'underway']);
    const taskId = check.taskId(args.taskId);
    const assignments = { ...mission.assignments };
    const ids = Array.isArray(args.to) ? [...new Set(args.to)] : [];
    if (ids.length > MAX_CREW) throw new ConvexError('A task can go to at most the whole crew.');
    for (const id of ids) {
      const row = await requireRow(ctx, mission._id, id);
      if (row.state === 'left') throw new ConvexError(`${row.name} has left the crew.`);
    }
    if (args.to === null || (Array.isArray(args.to) && ids.length === 0)) {
      delete assignments[taskId];
    } else {
      if (!(taskId in assignments) && Object.keys(assignments).length >= MAX_ASSIGNMENTS) throw new ConvexError('This mission has too many assigned tasks.');
      assignments[taskId] = args.to === EVERYONE ? EVERYONE : ids;
    }
    await ctx.db.patch(mission._id, { assignments });
    return null;
  },
});

export const start = mutation({
  args: { auth: authV, missionId: v.id('missions'), routeJson: v.string(), snapshotJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning']);
    const routeJson = check.json(args.routeJson, 'The route', LIMITS.routeBytes);
    const snapshotJson = check.json(args.snapshotJson, 'The live snapshot', LIMITS.snapshotBytes);
    const now = Date.now();
    const rows = await crewRows(ctx, mission._id);
    // The browser checks this before it asks; a stale or altered one is refused here all the same.
    const joined = rows.filter((r) => r.state === 'joined').length;
    const crewed = crewedVehicles((await planOf(ctx, mission._id))?.planJson ?? '');
    if (crewed > joined) throw new ConvexError(`${crewed} crewed vehicles need ${crewed} drivers, and the crew is ${joined}. Take fewer rovers or bring more people.`);
    // The crew is fixed once the run begins: unanswered invites lapse, and their tasks with them.
    let assignments = mission.assignments;
    for (const row of rows) {
      if (row.state !== 'invited') continue;
      assignments = dropCrewFrom(assignments, row._id) ?? assignments;
      await ctx.db.delete(row._id);
    }
    await ctx.db.patch(mission._id, { status: 'underway', startedAt: now, assignments });
    // A mission starts once, but clear anything left by an earlier attempt so there is only ever one live row.
    const oldLive = await liveOf(ctx, mission._id);
    if (oldLive) await ctx.db.delete(oldLive._id);
    const oldRoute = await routeOf(ctx, mission._id);
    if (oldRoute) await ctx.db.delete(oldRoute._id);
    await ctx.db.insert('routes', { missionId: mission._id, routeRev: 1, routeJson });
    await ctx.db.insert('live', { missionId: mission._id, snapshotJson, routeRev: 1, updatedAt: now });
    await systemLog(ctx, mission._id, `Mission underway. ${person.name} has command.`);
    return null;
  },
});

/** Called about once a second by the commander's browser, so it reads and writes as little as it can. */
export const publish = mutation({
  args: { auth: authV, missionId: v.id('missions'), snapshotJson: v.string(), routeJson: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['underway']);
    const snapshotJson = check.json(args.snapshotJson, 'The live snapshot', LIMITS.snapshotBytes);
    const live = await liveOf(ctx, mission._id);
    if (!live) throw new ConvexError('This mission has no live feed. Start it again.');
    let routeRev = live.routeRev;
    if (args.routeJson !== undefined) {
      const routeJson = check.json(args.routeJson, 'The route', LIMITS.routeBytes);
      routeRev += 1;
      const route = await routeOf(ctx, mission._id);
      if (route) await ctx.db.patch(route._id, { routeRev, routeJson });
      else await ctx.db.insert('routes', { missionId: mission._id, routeRev, routeJson });
    }
    await ctx.db.patch(live._id, { snapshotJson, routeRev, updatedAt: Date.now() });
    return routeRev;
  },
});

export const finish = mutation({
  args: { auth: authV, missionId: v.id('missions'), status: v.union(v.literal('complete'), v.literal('aborted')), debriefJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    // Aborting a mission that never started is how a commander cancels it.
    requireStatus(mission, args.status === 'aborted' ? ['planning', 'underway'] : ['underway']);
    const debriefJson = check.json(args.debriefJson, 'The debrief', LIMITS.debriefBytes);
    const now = Date.now();
    await ctx.db.patch(mission._id, { status: args.status, endedAt: now });
    const old = await debriefOf(ctx, mission._id);
    if (old) await ctx.db.patch(old._id, { debriefJson });
    else await ctx.db.insert('debriefs', { missionId: mission._id, debriefJson });
    for (const row of await crewRows(ctx, mission._id)) {
      if (row.state === 'invited') {
        await ctx.db.delete(row._id);
        continue;
      }
      await ctx.db.patch(row._id, { endedAt: now });
      if (row.state === 'joined') await releasePerson(ctx, row.personId, mission._id);
    }
    const line = args.status === 'complete' ? 'Mission complete.' : mission.status === 'planning' ? 'Mission cancelled before it started.' : 'Mission aborted.';
    await systemLog(ctx, mission._id, line);
    return null;
  },
});

export const transferCommand = mutation({
  args: { auth: authV, missionId: v.id('missions'), toCrewId: v.id('crew') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning', 'underway']);
    const target = await requireRow(ctx, mission._id, args.toCrewId);
    if (target.kind !== 'human' || target.state !== 'joined' || !target.personId) throw new ConvexError('Command can only pass to a person who has joined the crew.');
    if (target.personId === person.clientId) throw new ConvexError('You already have command.');
    const mine = await findRow(ctx, mission._id, person.clientId);
    if (mine) await ctx.db.patch(mine._id, { role: target.role });
    await ctx.db.patch(target._id, { role: COMMANDER_ROLE });
    await ctx.db.patch(mission._id, { commanderId: target.personId });
    await systemLog(ctx, mission._id, `${person.name} passed command to ${target.name}.`);
    return null;
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('missions'),
      title: v.string(),
      objective: v.string(),
      status: statusV,
      commanderId: v.string(),
      commanderName: v.string(),
      crewCount: v.number(),
      plannedStartUtc: v.union(v.number(), v.null()),
      vehicle: v.string(),
      siteName: v.union(v.string(), v.null()),
      open: v.boolean(),
      createdAt: v.number(),
      startedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const newest = (status: 'planning' | 'underway') =>
      ctx.db
        .query('missions')
        .withIndex('by_status', (q) => q.eq('status', status))
        .order('desc')
        .take(LIST_CAP);
    const [planning, underway] = await Promise.all([newest('planning'), newest('underway')]);
    const missions = [...planning, ...underway].sort((a, b) => b.createdAt - a.createdAt).slice(0, LIST_CAP);
    return Promise.all(
      missions.map(async (m) => {
        const [rows, commander] = await Promise.all([crewRows(ctx, m._id), findPerson(ctx, m.commanderId)]);
        return {
          _id: m._id,
          title: m.title,
          objective: m.objective,
          status: m.status,
          commanderId: m.commanderId,
          commanderName: commander?.name ?? 'Unknown',
          crewCount: rows.filter((r) => r.state === 'joined').length,
          plannedStartUtc: m.plannedStartUtc ?? null,
          vehicle: m.vehicle,
          siteName: m.siteName ?? null,
          open: m.open,
          createdAt: m.createdAt,
          startedAt: m.startedAt ?? null,
        };
      }),
    );
  },
});

export const mine = query({
  args: { clientId: v.string(), secret: v.string() },
  returns: v.object({
    current: v.union(v.id('missions'), v.null()),
    past: v.array(
      v.object({ missionId: v.id('missions'), title: v.string(), status: v.union(v.literal('complete'), v.literal('aborted')), endedAt: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    const person = await checkPerson(ctx, args.clientId, args.secret);
    if (!person) return { current: null, past: [] };
    const current = person.missionId ? await ctx.db.get(person.missionId) : null;
    // Rows get endedAt when their mission ends, so this range is exactly the person's history, newest first.
    const rows = await ctx.db
      .query('crew')
      .withIndex('by_personId_and_endedAt', (q) => q.eq('personId', person.clientId).gt('endedAt', 0))
      .order('desc')
      .take(HISTORY_CAP);
    const past = [];
    for (const row of rows) {
      const m = await ctx.db.get(row.missionId);
      if (!m || (m.status !== 'complete' && m.status !== 'aborted')) continue;
      past.push({ missionId: m._id, title: m.title, status: m.status, endedAt: m.endedAt ?? row.endedAt ?? 0 });
    }
    return { current: isActive(current) ? current._id : null, past };
  },
});

export const get = query({
  args: { missionId: v.id('missions'), clientId: v.optional(v.string()), secret: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      mission: missionOutV,
      crew: v.array(crewOutV),
      isCommander: v.boolean(),
      isCrew: v.boolean(),
      myCrewId: v.union(v.id('crew'), v.null()),
      myState: v.union(crewStateV, v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const mission = await ctx.db.get(args.missionId);
    if (!mission) return null;
    const [rows, plan] = await Promise.all([crewRows(ctx, mission._id), planOf(ctx, mission._id)]);
    const mine = args.clientId ? rows.find((r) => r.personId === args.clientId) : undefined;
    // The clientId alone is public, so it only drives what the UI shows. Reading the debrief takes the secret.
    let debriefJson: string | null = null;
    if (mine && (mine.state === 'joined' || mine.state === 'left') && (mission.status === 'complete' || mission.status === 'aborted')) {
      const person = await checkPerson(ctx, args.clientId, args.secret);
      if (person) debriefJson = (await debriefOf(ctx, mission._id))?.debriefJson ?? null;
    }
    return {
      mission: {
        _id: mission._id,
        title: mission.title,
        objective: mission.objective,
        commanderId: mission.commanderId,
        status: mission.status,
        plannedStartUtc: mission.plannedStartUtc ?? null,
        planJson: plan?.planJson ?? '',
        planRev: mission.planRev,
        vehicle: mission.vehicle,
        siteName: mission.siteName ?? null,
        open: mission.open,
        createdAt: mission.createdAt,
        startedAt: mission.startedAt ?? null,
        endedAt: mission.endedAt ?? null,
        assignments: mission.assignments,
        debriefJson,
      },
      crew: rows.map(crewOut),
      isCommander: !!args.clientId && args.clientId === mission.commanderId,
      isCrew: mine?.state === 'joined',
      myCrewId: mine?._id ?? null,
      myState: mine?.state ?? null,
    };
  },
});

export const live = query({
  args: { auth: authV, missionId: v.id('missions') },
  returns: v.union(v.null(), v.object({ snapshotJson: v.string(), routeRev: v.number(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    // The run holds the crew's radio and where they are: crew only.
    if (!(await isCrewOf(ctx, args.missionId, args.auth.clientId, args.auth.secret))) return null;
    const live = await liveOf(ctx, args.missionId);
    return live ? { snapshotJson: live.snapshotJson, routeRev: live.routeRev, updatedAt: live.updatedAt } : null;
  },
});

/** Kept apart from live so the big route is sent when it changes, not with every snapshot. */
export const route = query({
  // routeRev is not needed to find the row; it changes the subscription when the live feed says the route moved.
  args: { auth: authV, missionId: v.id('missions'), routeRev: v.number() },
  returns: v.union(v.null(), v.object({ routeRev: v.number(), routeJson: v.string() })),
  handler: async (ctx, args) => {
    if (!(await isCrewOf(ctx, args.missionId, args.auth.clientId, args.auth.secret))) return null;
    const route = await routeOf(ctx, args.missionId);
    return route ? { routeRev: route.routeRev, routeJson: route.routeJson } : null;
  },
});

/** A run whose commander has not published for this long has lost its commander. */
const STALE_RUN_MS = 10 * 60_000;
/** A plan nobody has touched, and whose commander is offline, is cleared after this long. */
const STALE_PLAN_MS = 12 * 3_600_000;

/**
 * Ends missions whose commander is gone: an underway run with no snapshot for ten minutes, or a plan
 * whose commander has been offline half a sol. Otherwise they would sit in "Missions you can join" for
 * ever, and their crew could never join anything else. No debrief is written (only the commander's browser
 * held the run); the crew log says why it ended.
 */
/** How long the commander's browser may stay silent after the run ended before the server closes the mission. */
const ENDED_SILENT_MS = 60_000;

/** How the run in a live snapshot ended ('done' or 'aborted'), or null while it runs or the snapshot is unreadable. */
function runEnd(snapshotJson: string): 'done' | 'aborted' | null {
  try {
    const status: unknown = (JSON.parse(snapshotJson) as { world?: { run?: { status?: unknown } } }).world?.run?.status;
    return status === 'done' || status === 'aborted' ? status : null;
  } catch {
    return null;
  }
}

export const sweepAbandoned = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const close = async (mission: Doc<'missions'>, why: string, status: 'aborted' | 'complete' = 'aborted') => {
      await ctx.db.patch(mission._id, { status, endedAt: now });
      for (const row of await crewRows(ctx, mission._id)) {
        if (row.state === 'invited') {
          await ctx.db.delete(row._id);
          continue;
        }
        await ctx.db.patch(row._id, { endedAt: now });
        if (row.state === 'joined') await releasePerson(ctx, row.personId, mission._id);
      }
      await systemLog(ctx, mission._id, why);
    };
    for (const mission of await ctx.db.query('missions').withIndex('by_status', (q) => q.eq('status', 'underway')).take(50)) {
      const live = await ctx.db.query('live').withIndex('by_missionId', (q) => q.eq('missionId', mission._id)).unique();
      const last = live?.updatedAt ?? mission.startedAt ?? mission.createdAt;
      // A run that had already ended when the commander's browser went (closed before it filed the debrief) is
      // closed as it ended, after a minute rather than ten, and is not called lost.
      const ended = live ? runEnd(live.snapshotJson) : null;
      if (ended && now - last > ENDED_SILENT_MS) await close(mission, `Mission ${ended === 'done' ? 'complete' : 'aborted'}. The commander’s browser closed before the debrief was written.`, ended === 'done' ? 'complete' : 'aborted');
      else if (now - last > STALE_RUN_MS) await close(mission, 'Mission aborted: the commander’s link was lost for ten minutes.');
    }
    for (const mission of await ctx.db.query('missions').withIndex('by_status', (q) => q.eq('status', 'planning')).take(50)) {
      if (now - mission.createdAt < STALE_PLAN_MS) continue;
      const commander = await findPerson(ctx, mission.commanderId);
      const seen = commander ? await lastHere(ctx, commander) : null;
      if (seen?.online) continue;
      if (seen && now - seen.at < STALE_PLAN_MS) continue;
      await close(mission, 'Mission cancelled: the commander has been away for half a sol.');
    }
    return null;
  },
});
