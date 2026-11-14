/**
 * Who is on a mission. Humans arrive by invite or by joining an open mission; androids are added by the
 * commander and are crew rows with no person behind them. Only the commander shapes the crew.
 */
import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { checkPerson, findPerson, requireCommander, requireMission, requirePerson, requireStatus } from './lib/auth';
import * as check from './lib/check';
import { crewRows, dropAssignments, findRow, nextOrder, releasePerson, requireFree, requireRoom, requireRow, systemLog } from './lib/crew';
import { authV } from './lib/validators';
import { ANDROID_CALLSIGNS, ANDROID_COLOR, DEFAULT_ROLE, LIMITS } from './shared';

const INVITES_CAP = 20;

/** Takes a row off the crew: gone entirely while planning, kept as "left" once the run has begun so history holds. */
async function takeOff(ctx: MutationCtx, mission: Doc<'missions'>, row: Doc<'crew'>): Promise<void> {
  if (mission.status === 'underway' && row.state === 'joined' && row.kind === 'human') await ctx.db.patch(row._id, { state: 'left' });
  else await ctx.db.delete(row._id);
  await dropAssignments(ctx, mission, row._id);
  if (row.state === 'joined') await releasePerson(ctx, row.personId, mission._id);
}

/** Moves an invited or departed row onto the crew, last in the walking order. */
async function seat(ctx: MutationCtx, person: Doc<'people'>, row: Doc<'crew'>): Promise<void> {
  await ctx.db.patch(row._id, { state: 'joined', joinedAt: Date.now(), order: await nextOrder(ctx, row.missionId), name: person.name, color: person.color });
  await ctx.db.patch(person._id, { missionId: row.missionId });
}

export const invite = mutation({
  args: { auth: authV, missionId: v.id('missions'), personId: v.string(), role: v.optional(v.string()) },
  returns: v.id('crew'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning']);
    const role = args.role === undefined ? DEFAULT_ROLE : check.text(args.role, 'Role', 1, LIMITS.role);
    const target = await findPerson(ctx, args.personId);
    if (!target) throw new ConvexError('That person is no longer around.');
    const existing = await findRow(ctx, mission._id, target.clientId);
    if (existing?.state === 'invited') throw new ConvexError(`${target.name} is already invited.`);
    if (existing) throw new ConvexError(`${target.name} is already on the crew.`);
    await requireRoom(ctx, mission._id);
    return ctx.db.insert('crew', {
      missionId: mission._id,
      kind: 'human',
      personId: target.clientId,
      name: target.name,
      role,
      color: target.color,
      state: 'invited',
      joinedAt: Date.now(),
      order: await nextOrder(ctx, mission._id),
    });
  },
});

export const respond = mutation({
  args: { auth: authV, missionId: v.id('missions'), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const row = await findRow(ctx, args.missionId, person.clientId);
    if (!row || row.state !== 'invited') throw new ConvexError('That invite is no longer open.');
    if (!args.accept) {
      await ctx.db.delete(row._id);
      return null;
    }
    const mission = await requireMission(ctx, args.missionId);
    requireStatus(mission, ['planning']);
    await requireFree(ctx, person);
    await seat(ctx, person, row);
    await systemLog(ctx, mission._id, `${person.name} joined the crew.`);
    return null;
  },
});

export const join = mutation({
  args: { auth: authV, missionId: v.id('missions') },
  returns: v.id('crew'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireMission(ctx, args.missionId);
    requireStatus(mission, ['planning', 'underway']);
    const row = await findRow(ctx, mission._id, person.clientId);
    if (row?.state === 'joined') throw new ConvexError('You are already on this crew.');
    // An invite is a way in even when the mission is closed.
    if (!mission.open && row?.state !== 'invited') throw new ConvexError('This mission is not open to join. Ask the commander for an invite.');
    await requireFree(ctx, person);
    if (row) {
      // Someone who left during the run takes a seat again, so there must be room for them.
      if (row.state === 'left') await requireRoom(ctx, mission._id);
      await seat(ctx, person, row);
      await systemLog(ctx, mission._id, `${person.name} joined the crew.`);
      return row._id;
    }
    await requireRoom(ctx, mission._id);
    const crewId = await ctx.db.insert('crew', {
      missionId: mission._id,
      kind: 'human',
      personId: person.clientId,
      name: person.name,
      role: DEFAULT_ROLE,
      color: person.color,
      state: 'joined',
      joinedAt: Date.now(),
      order: await nextOrder(ctx, mission._id),
    });
    await ctx.db.patch(person._id, { missionId: mission._id });
    await systemLog(ctx, mission._id, `${person.name} joined the crew.`);
    return crewId;
  },
});

export const leave = mutation({
  args: { auth: authV, missionId: v.id('missions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireMission(ctx, args.missionId);
    requireStatus(mission, ['planning', 'underway']);
    if (mission.commanderId === person.clientId) {
      throw new ConvexError('The commander can’t leave. Pass command to someone else first, or cancel the mission.');
    }
    const row = await findRow(ctx, mission._id, person.clientId);
    if (!row || row.state === 'left') throw new ConvexError('You are not on this crew.');
    await takeOff(ctx, mission, row);
    if (row.state === 'joined') await systemLog(ctx, mission._id, `${person.name} left the crew.`);
    return null;
  },
});

export const addAndroid = mutation({
  args: { auth: authV, missionId: v.id('missions'), name: v.optional(v.string()), role: v.string() },
  returns: v.id('crew'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning']);
    const role = check.text(args.role, 'Role', 1, LIMITS.role);
    await requireRoom(ctx, mission._id);
    let name: string;
    if (args.name !== undefined && args.name.trim() !== '') {
      name = check.text(args.name, 'Name', 1, LIMITS.name);
    } else {
      const taken = new Set((await crewRows(ctx, mission._id)).map((r) => r.name));
      // There are more callsigns than seats, so one is always free.
      name = ANDROID_CALLSIGNS.find((c) => !taken.has(c)) ?? ANDROID_CALLSIGNS[0];
    }
    return ctx.db.insert('crew', {
      missionId: mission._id,
      kind: 'android',
      name,
      role,
      color: ANDROID_COLOR,
      state: 'joined',
      joinedAt: Date.now(),
      order: await nextOrder(ctx, mission._id),
    });
  },
});

export const update = mutation({
  args: { auth: authV, missionId: v.id('missions'), crewId: v.id('crew'), role: v.optional(v.string()), name: v.optional(v.string()), order: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning', 'underway']);
    const row = await requireRow(ctx, mission._id, args.crewId);
    const patch: Partial<Doc<'crew'>> = {};
    if (args.role !== undefined) patch.role = check.text(args.role, 'Role', 1, LIMITS.role);
    if (args.name !== undefined) {
      // A person's name is theirs to change; the commander names only androids.
      if (row.kind !== 'android') throw new ConvexError('Only an android can be renamed here.');
      patch.name = check.text(args.name, 'Name', 1, LIMITS.name);
    }
    if (args.order !== undefined) patch.order = check.order(args.order);
    await ctx.db.patch(row._id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { auth: authV, missionId: v.id('missions'), crewId: v.id('crew') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning', 'underway']);
    const row = await requireRow(ctx, mission._id, args.crewId);
    if (row.personId === person.clientId) throw new ConvexError('You can’t remove yourself. Pass command first, or cancel the mission.');
    if (row.state === 'left') throw new ConvexError(`${row.name} has already left.`);
    await takeOff(ctx, mission, row);
    if (row.state === 'joined') await systemLog(ctx, mission._id, `${row.name} was taken off the crew.`);
    return null;
  },
});

export const invitesFor = query({
  args: { clientId: v.string(), secret: v.string() },
  returns: v.array(
    v.object({ crewId: v.id('crew'), missionId: v.id('missions'), title: v.string(), commanderName: v.string(), role: v.string(), invitedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const person = await checkPerson(ctx, args.clientId, args.secret);
    if (!person) return [];
    const rows = await ctx.db
      .query('crew')
      .withIndex('by_personId_and_state', (q) => q.eq('personId', person.clientId).eq('state', 'invited'))
      .order('desc')
      .take(INVITES_CAP);
    const invites = [];
    for (const row of rows) {
      const mission = await ctx.db.get(row.missionId);
      if (!mission || mission.status !== 'planning') continue;
      const commander = await findPerson(ctx, mission.commanderId);
      invites.push({ crewId: row._id, missionId: mission._id, title: mission.title, commanderName: commander?.name ?? 'Unknown', role: row.role, invitedAt: row.joinedAt });
    }
    return invites;
  },
});
