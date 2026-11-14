/**
 * People and presence. A person is a browser with a name; "online" means it has sent a heartbeat lately.
 * The cron in crons.ts marks the silent ones offline, so a closed tab does not linger in everyone's list.
 */
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { findPerson, hashSecret, requirePerson } from './lib/auth';
import * as check from './lib/check';
import { findRow } from './lib/crew';
import { suitColorV, viewV, whereV } from './lib/validators';
import { LIMITS, STALE_MS } from './shared';

const SWEEP_BATCH = 200;
const ONLINE_CAP = 200;

const personOutV = v.object({
  clientId: v.string(),
  name: v.string(),
  color: suitColorV,
  view: viewV,
  where: v.union(whereV, v.null()),
  missionId: v.union(v.id('missions'), v.null()),
});

function personOut(p: Doc<'people'>) {
  return { clientId: p.clientId, name: p.name, color: p.color, view: p.view, where: p.where ?? null, missionId: p.missionId ?? null };
}

/** The crew row carries a copy of the name and color, so a rename shows up on the mission too. */
async function syncCrewRow(ctx: MutationCtx, person: Doc<'people'>, missionId: Id<'missions'> | undefined) {
  if (!missionId) return;
  const row = await findRow(ctx, missionId, person.clientId);
  if (row && row.state !== 'left') await ctx.db.patch(row._id, { name: person.name, color: person.color });
}

export const register = mutation({
  args: { clientId: v.string(), secret: v.string(), name: v.string(), color: suitColorV },
  returns: personOutV,
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(args.clientId)) throw new ConvexError('This browser’s id is not valid. Clear the site data and reload.');
    if (args.secret.length < 32 || args.secret.length > 256) throw new ConvexError('This browser’s key is not valid. Clear the site data and reload.');
    const name = check.text(args.name, 'Name', 1, LIMITS.name);
    const now = Date.now();
    const existing = await findPerson(ctx, args.clientId);
    if (existing) {
      const person = await requirePerson(ctx, args.clientId, args.secret);
      await ctx.db.patch(person._id, { name, color: args.color, online: true, lastSeen: now });
      const next = { ...person, name, color: args.color, online: true, lastSeen: now };
      await syncCrewRow(ctx, next, person.missionId);
      return personOut(next);
    }
    const secretHash = await hashSecret(args.clientId, args.secret);
    const id = await ctx.db.insert('people', { clientId: args.clientId, secretHash, name, color: args.color, online: true, lastSeen: now, view: 'map' });
    const person = await ctx.db.get(id);
    if (!person) throw new ConvexError('Could not register. Try again.');
    return personOut(person);
  },
});

export const rename = mutation({
  args: { clientId: v.string(), secret: v.string(), name: v.string(), color: suitColorV },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.clientId, args.secret);
    const name = check.text(args.name, 'Name', 1, LIMITS.name);
    await ctx.db.patch(person._id, { name, color: args.color });
    await syncCrewRow(ctx, { ...person, name, color: args.color }, person.missionId);
    return null;
  },
});

export const heartbeat = mutation({
  args: { clientId: v.string(), secret: v.string(), view: viewV, where: v.optional(whereV) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.clientId, args.secret);
    // A map heartbeat means the person stepped out of Rover View; a rover beat without a position keeps the last one.
    const where = args.where ? check.where(args.where) : args.view === 'map' ? undefined : person.where;
    await ctx.db.patch(person._id, { online: true, lastSeen: Date.now(), view: args.view, where });
    return null;
  },
});

export const leave = mutation({
  args: { clientId: v.string(), secret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.clientId, args.secret);
    if (person.online) await ctx.db.patch(person._id, { online: false });
    return null;
  },
});

export const online = query({
  args: {},
  returns: v.array(personOutV),
  handler: async (ctx) => {
    const people = await ctx.db
      .query('people')
      .withIndex('by_online_and_lastSeen', (q) => q.eq('online', true))
      .order('desc')
      .take(ONLINE_CAP);
    return people.map(personOut);
  },
});

/** Runs from the cron. Marks people offline in batches and goes again at once if a batch came back full. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const stale = await ctx.db
      .query('people')
      .withIndex('by_online_and_lastSeen', (q) => q.eq('online', true).lt('lastSeen', cutoff))
      .take(SWEEP_BATCH);
    for (const p of stale) await ctx.db.patch(p._id, { online: false });
    if (stale.length === SWEEP_BATCH) await ctx.scheduler.runAfter(0, internal.people.sweep, {});
    return null;
  },
});
