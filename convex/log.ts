/** The shared crew log. Crew write notes, radio calls and task updates; the commander's browser adds run events. */
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCommander, requireMission, requirePerson, requireStatus } from './lib/auth';
import * as check from './lib/check';
import { findRow, isCrewOf, systemLog } from './lib/crew';
import { authV, logKindV } from './lib/validators';
import { LIMITS } from './shared';

const LIST_CAP = 200;

export const add = mutation({
  args: {
    auth: authV,
    missionId: v.id('missions'),
    kind: v.union(v.literal('note'), v.literal('radio'), v.literal('task')),
    text: v.string(),
    missionUtcMs: v.optional(v.number()),
    taskId: v.optional(v.string()),
  },
  returns: v.id('log'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireMission(ctx, args.missionId);
    requireStatus(mission, ['planning', 'underway']);
    const row = await findRow(ctx, mission._id, person.clientId);
    if (!row || row.state !== 'joined') throw new ConvexError('Only crew of this mission can write in its log.');
    return ctx.db.insert('log', {
      missionId: mission._id,
      authorId: person.clientId,
      authorName: row.name,
      kind: args.kind,
      text: check.text(args.text, 'The log entry', 1, LIMITS.logText),
      missionUtcMs: args.missionUtcMs === undefined ? undefined : check.time(args.missionUtcMs, 'Mission time'),
      taskId: args.taskId === undefined ? undefined : check.taskId(args.taskId),
      createdAt: Date.now(),
    });
  },
});

/** Run events such as "Dust devil warning; route changed", written by the commander's simulation. */
export const addSystem = mutation({
  args: { auth: authV, missionId: v.id('missions'), text: v.string(), missionUtcMs: v.optional(v.number()), taskId: v.optional(v.string()) },
  returns: v.id('log'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireCommander(ctx, args.missionId, person);
    requireStatus(mission, ['planning', 'underway']);
    const text = check.text(args.text, 'The log entry', 1, LIMITS.logText);
    const missionUtcMs = args.missionUtcMs === undefined ? undefined : check.time(args.missionUtcMs, 'Mission time');
    const taskId = args.taskId === undefined ? undefined : check.taskId(args.taskId);
    return systemLog(ctx, mission._id, text, missionUtcMs, taskId);
  },
});

export const list = query({
  args: { auth: authV, missionId: v.id('missions') },
  returns: v.array(
    v.object({
      _id: v.id('log'),
      authorId: v.string(),
      authorName: v.string(),
      kind: logKindV,
      text: v.string(),
      missionUtcMs: v.union(v.number(), v.null()),
      taskId: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // The crew log is the crew's own radio and notes.
    if (!(await isCrewOf(ctx, args.missionId, args.auth.clientId, args.auth.secret))) return [];
    const newest = await ctx.db
      .query('log')
      .withIndex('by_missionId', (q) => q.eq('missionId', args.missionId))
      .order('desc')
      .take(LIST_CAP);
    return newest.reverse().map((e) => ({
      _id: e._id,
      authorId: e.authorId,
      authorName: e.authorName,
      kind: e.kind,
      text: e.text,
      missionUtcMs: e.missionUtcMs ?? null,
      taskId: e.taskId ?? null,
      createdAt: e.createdAt,
    }));
  },
});
