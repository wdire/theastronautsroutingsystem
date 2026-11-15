/**
 * People and presence. A person is a browser with a name; "online" means it has sent a heartbeat lately.
 * The cron in crons.ts marks the silent ones offline, so a closed tab does not linger in everyone's list.
 *
 * The person's row holds only what rarely changes (name, colour, mission), because every query that checks who
 * is asking reads it. What changes often lives apart: `presence` (online, map or Rover View: changes when someone
 * comes, goes or switches), `beats` (the heartbeat's time, read only by the sweep) and `positions` (where someone
 * stands in Rover View, read only by others in Rover View).
 */
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { findPerson, hashSecret, requirePerson } from './lib/auth';
import * as check from './lib/check';
import { findRow } from './lib/crew';
import { markGone, markHere, positionOf } from './lib/presence';
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

function personOut(p: Doc<'people'>, view: Doc<'presence'>['view']) {
  return { clientId: p.clientId, name: p.name, color: p.color, view, where: null, missionId: p.missionId ?? null };
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
      // Written only when something changed: an unchanged row keeps everyone's subscriptions to it quiet.
      if (person.name !== name || person.color !== args.color) await ctx.db.patch(person._id, { name, color: args.color });
      const next = { ...person, name, color: args.color };
      await syncCrewRow(ctx, next, person.missionId);
      await markHere(ctx, args.clientId, 'map', now);
      return personOut(next, 'map');
    }
    const secretHash = await hashSecret(args.clientId, args.secret);
    const id = await ctx.db.insert('people', { clientId: args.clientId, secretHash, name, color: args.color });
    const person = await ctx.db.get(id);
    if (!person) throw new ConvexError('Could not register. Try again.');
    await markHere(ctx, args.clientId, 'map', now);
    return personOut(person, 'map');
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
    const now = Date.now();
    await markHere(ctx, person.clientId, args.view, now);
    // A map heartbeat means the person stepped out of Rover View; a rover beat without a position keeps the last one.
    const position = await positionOf(ctx, person.clientId);
    if (args.where) {
      const where = check.where(args.where);
      if (position) await ctx.db.patch(position._id, { where, updatedAt: now });
      else await ctx.db.insert('positions', { clientId: person.clientId, where, updatedAt: now });
    } else if (args.view === 'map' && position) {
      await ctx.db.delete(position._id);
    }
    return null;
  },
});

export const leave = mutation({
  args: { clientId: v.string(), secret: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.clientId, args.secret);
    await markGone(ctx, person.clientId, Date.now());
    return null;
  },
});

export const online = query({
  args: {},
  returns: v.array(personOutV),
  handler: async (ctx) => {
    const here = await ctx.db
      .query('presence')
      .withIndex('by_online', (q) => q.eq('online', true))
      .take(ONLINE_CAP);
    const out = [];
    // Newest arrivals first, as the list read before.
    for (const p of here.sort((a, b) => b.since - a.since)) {
      const person = await findPerson(ctx, p.clientId);
      if (person) out.push(personOut(person, p.view));
    }
    return out;
  },
});

/** Everyone standing in Rover View and where, for others in Rover View to draw. Subscribed to only there. */
export const walkers = query({
  args: {},
  returns: v.array(v.object({ clientId: v.string(), name: v.string(), color: suitColorV, where: whereV })),
  handler: async (ctx) => {
    const rows = await ctx.db.query('positions').take(ONLINE_CAP);
    const out = [];
    for (const row of rows) {
      const person = await findPerson(ctx, row.clientId);
      if (person) out.push({ clientId: row.clientId, name: person.name, color: person.color, where: row.where });
    }
    return out;
  },
});

/** Runs from the cron. Marks people offline in batches and goes again at once if a batch came back full. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('beats')
      .withIndex('by_lastSeen', (q) => q.lt('lastSeen', now - STALE_MS))
      .take(SWEEP_BATCH);
    for (const beat of stale) await markGone(ctx, beat.clientId, beat.lastSeen);
    if (stale.length === SWEEP_BATCH) await ctx.scheduler.runAfter(0, internal.people.sweep, {});
    return null;
  },
});
