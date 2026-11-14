/** Private notes. Every read and write checks the author's secret; nobody else, the commander included, sees them. */
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { checkPerson, requireMission, requirePerson } from './lib/auth';
import * as check from './lib/check';
import { findRow } from './lib/crew';
import { authV } from './lib/validators';
import { LIMITS } from './shared';

const LIST_CAP = 200;

async function requireOwnNote(ctx: MutationCtx, person: Doc<'people'>, noteId: Id<'notes'>): Promise<Doc<'notes'>> {
  const note = await ctx.db.get(noteId);
  // Someone else's note answers the same as a missing one, so ids reveal nothing.
  if (!note || note.authorId !== person.clientId) throw new ConvexError('That note no longer exists.');
  return note;
}

export const list = query({
  args: { auth: authV, missionId: v.id('missions') },
  returns: v.array(
    v.object({ _id: v.id('notes'), text: v.string(), missionUtcMs: v.union(v.number(), v.null()), createdAt: v.number(), updatedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const person = await checkPerson(ctx, args.auth.clientId, args.auth.secret);
    if (!person) return [];
    const newest = await ctx.db
      .query('notes')
      .withIndex('by_missionId_and_authorId', (q) => q.eq('missionId', args.missionId).eq('authorId', person.clientId))
      .order('desc')
      .take(LIST_CAP);
    return newest.reverse().map((n) => ({ _id: n._id, text: n.text, missionUtcMs: n.missionUtcMs ?? null, createdAt: n.createdAt, updatedAt: n.updatedAt }));
  },
});

export const add = mutation({
  args: { auth: authV, missionId: v.id('missions'), text: v.string(), missionUtcMs: v.optional(v.number()) },
  returns: v.id('notes'),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const mission = await requireMission(ctx, args.missionId);
    // Crew past and present may keep notes, including after the mission ends.
    const row = await findRow(ctx, mission._id, person.clientId);
    if (!row || row.state === 'invited') throw new ConvexError('Only crew of this mission can keep notes on it.');
    const now = Date.now();
    return ctx.db.insert('notes', {
      missionId: mission._id,
      authorId: person.clientId,
      text: check.text(args.text, 'The note', 1, LIMITS.noteText),
      missionUtcMs: args.missionUtcMs === undefined ? undefined : check.time(args.missionUtcMs, 'Mission time'),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { auth: authV, noteId: v.id('notes'), text: v.string(), missionUtcMs: v.optional(v.union(v.number(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const note = await requireOwnNote(ctx, person, args.noteId);
    const patch: Partial<Doc<'notes'>> = { text: check.text(args.text, 'The note', 1, LIMITS.noteText), updatedAt: Date.now() };
    if (args.missionUtcMs !== undefined) patch.missionUtcMs = args.missionUtcMs === null ? undefined : check.time(args.missionUtcMs, 'Mission time');
    await ctx.db.patch(note._id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { auth: authV, noteId: v.id('notes') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const note = await requireOwnNote(ctx, person, args.noteId);
    await ctx.db.delete(note._id);
    return null;
  },
});
