/** Presence helpers: who is here, their heartbeat, and where they stand in Rover View. See convex/people.ts. */
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const presenceOf = (ctx: QueryCtx, clientId: string) => ctx.db.query('presence').withIndex('by_clientId', (q) => q.eq('clientId', clientId)).unique();
export const beatOf = (ctx: QueryCtx, clientId: string) => ctx.db.query('beats').withIndex('by_clientId', (q) => q.eq('clientId', clientId)).unique();
export const positionOf = (ctx: QueryCtx, clientId: string) => ctx.db.query('positions').withIndex('by_clientId', (q) => q.eq('clientId', clientId)).unique();

/** Here, in this view: the presence row is written only when that is news; the heartbeat's time always. */
export async function markHere(ctx: MutationCtx, clientId: string, view: Doc<'presence'>['view'], now: number): Promise<void> {
  const presence = await presenceOf(ctx, clientId);
  if (!presence) await ctx.db.insert('presence', { clientId, online: true, view, since: now });
  else if (!presence.online || presence.view !== view) await ctx.db.patch(presence._id, { online: true, view, since: presence.online ? presence.since : now });
  const beat = await beatOf(ctx, clientId);
  if (beat) await ctx.db.patch(beat._id, { lastSeen: now });
  else await ctx.db.insert('beats', { clientId, lastSeen: now });
}

/** Gone: offline since now, no heartbeat to sweep, no place in Rover View. */
export async function markGone(ctx: MutationCtx, clientId: string, now: number): Promise<void> {
  const presence = await presenceOf(ctx, clientId);
  if (presence?.online) await ctx.db.patch(presence._id, { online: false, since: now });
  const beat = await beatOf(ctx, clientId);
  if (beat) await ctx.db.delete(beat._id);
  const position = await positionOf(ctx, clientId);
  if (position) await ctx.db.delete(position._id);
}

/** When a person was last here: now if online, else when they left (or, for rows from before presence, their old lastSeen). */
export async function lastHere(ctx: QueryCtx, person: Doc<'people'>): Promise<{ online: boolean; at: number }> {
  const presence = await presenceOf(ctx, person.clientId);
  if (presence) return { online: presence.online, at: presence.online ? Date.now() : presence.since };
  return { online: false, at: person.lastSeen ?? 0 };
}
