/**
 * The crew's base. There is one, shared by everyone: every crewed mission leaves from it and comes back to it,
 * so it may not move while a mission is out. The browser checks the ground (slope) before asking; the server
 * checks what it can know: the person, the region, and that no mission is under way.
 */
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requirePerson } from './lib/auth';
import { authV } from './lib/validators';
import { BASE_REGION } from './shared';

const baseV = v.object({ lon: v.number(), lat: v.number(), name: v.string(), movedByName: v.string(), movedAt: v.number() });

export const get = query({
  args: {},
  returns: v.union(baseV, v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query('bases')
      .withIndex('by_key', (q) => q.eq('key', 'main'))
      .unique();
    return row ? { lon: row.lon, lat: row.lat, name: row.name, movedByName: row.movedByName, movedAt: row.movedAt } : null;
  },
});

export const move = mutation({
  args: { auth: authV, lon: v.number(), lat: v.number(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const person = await requirePerson(ctx, args.auth.clientId, args.auth.secret);
    const [w, s, e, n] = BASE_REGION;
    if (!Number.isFinite(args.lon) || !Number.isFinite(args.lat) || args.lon < w || args.lon > e || args.lat < s || args.lat > n) {
      throw new ConvexError('That is outside the mapped region. The base needs terrain the planner can route over.');
    }
    const out = await ctx.db
      .query('missions')
      .withIndex('by_status', (q) => q.eq('status', 'underway'))
      .first();
    if (out) throw new ConvexError(`“${out.title}” is out from the base. The base can move once every mission is back.`);
    const name = args.name.trim().slice(0, 40) || 'Jezero Station';
    const row = await ctx.db
      .query('bases')
      .withIndex('by_key', (q) => q.eq('key', 'main'))
      .unique();
    const fields = { lon: args.lon, lat: args.lat, name, movedById: person.clientId, movedByName: person.name, movedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert('bases', { key: 'main', ...fields });
    return null;
  },
});
