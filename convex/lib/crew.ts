/** Crew helpers shared by missions, crew and log. A crew never has more than a few dozen rows, so reads are bounded. */
import { ConvexError, v } from 'convex/values';
import { checkPerson } from './auth';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { MAX_CREW } from '../shared';
import { isActive } from './auth';
import { crewColorV, crewKindV, crewStateV } from './validators';

type Ctx = QueryCtx | MutationCtx;

// Active rows stay at MAX_CREW; this also leaves room for people who left during a run.
const CREW_READ_CAP = 64;

export const crewOutV = v.object({
  _id: v.id('crew'),
  kind: crewKindV,
  personId: v.union(v.string(), v.null()),
  name: v.string(),
  role: v.string(),
  color: crewColorV,
  state: crewStateV,
  joinedAt: v.number(),
  order: v.number(),
});

export function crewOut(row: Doc<'crew'>) {
  return {
    _id: row._id,
    kind: row.kind,
    personId: row.personId ?? null,
    name: row.name,
    role: row.role,
    color: row.color,
    state: row.state,
    joinedAt: row.joinedAt,
    order: row.order,
  };
}

/** Every row of a mission's crew, in walking order. */
export function crewRows(ctx: Ctx, missionId: Id<'missions'>): Promise<Doc<'crew'>[]> {
  return ctx.db
    .query('crew')
    .withIndex('by_missionId_and_order', (q) => q.eq('missionId', missionId))
    .take(CREW_READ_CAP);
}

/**
 * Whether the caller is, or was, crew of the mission: only they may read its run, route and log. Queries
 * never throw on bad credentials; they read as "not crew".
 */
export async function isCrewOf(ctx: Ctx, missionId: Id<'missions'>, clientId: string, secret: string): Promise<boolean> {
  const person = await checkPerson(ctx, clientId, secret);
  if (!person) return false;
  const row = await findRow(ctx, missionId, person.clientId);
  return row !== null && (row.state === 'joined' || row.state === 'left');
}

export function findRow(ctx: Ctx, missionId: Id<'missions'>, personId: string): Promise<Doc<'crew'> | null> {
  return ctx.db
    .query('crew')
    .withIndex('by_missionId_and_personId', (q) => q.eq('missionId', missionId).eq('personId', personId))
    .first();
}

export async function requireRow(ctx: Ctx, missionId: Id<'missions'>, crewId: Id<'crew'>): Promise<Doc<'crew'>> {
  const row = await ctx.db.get(crewId);
  if (!row || row.missionId !== missionId) throw new ConvexError('That crew member is not on this mission.');
  return row;
}

export async function nextOrder(ctx: Ctx, missionId: Id<'missions'>): Promise<number> {
  const last = await ctx.db
    .query('crew')
    .withIndex('by_missionId_and_order', (q) => q.eq('missionId', missionId))
    .order('desc')
    .first();
  return last ? last.order + 1 : 0;
}

/** Throws when one more invite, human or android would take the crew past its size. */
export async function requireRoom(ctx: Ctx, missionId: Id<'missions'>): Promise<void> {
  const rows = await crewRows(ctx, missionId);
  const taken = rows.filter((r) => r.state !== 'left').length;
  if (taken >= MAX_CREW) throw new ConvexError(`A crew can have at most ${MAX_CREW} members, counting androids and open invites.`);
}

/** One person, one live mission: the client offers to leave the current one first. */
export async function requireFree(ctx: Ctx, person: Doc<'people'>): Promise<void> {
  if (!person.missionId) return;
  const current = await ctx.db.get(person.missionId);
  if (isActive(current)) throw new ConvexError(`You are already crew of “${current.title}”. Leave it first.`);
}

/** Forgets a crew member's tasks, so nothing stays assigned to someone who is gone. */
export async function dropAssignments(ctx: MutationCtx, mission: Doc<'missions'>, crewId: Id<'crew'>): Promise<void> {
  const kept = Object.fromEntries(Object.entries(mission.assignments).filter(([, id]) => id !== crewId));
  if (Object.keys(kept).length !== Object.keys(mission.assignments).length) await ctx.db.patch(mission._id, { assignments: kept });
}

/** Clears a person's current mission, but only if it still points at this one. */
export async function releasePerson(ctx: MutationCtx, personId: string | undefined, missionId: Id<'missions'>): Promise<void> {
  if (!personId) return;
  const person = await ctx.db
    .query('people')
    .withIndex('by_clientId', (q) => q.eq('clientId', personId))
    .unique();
  if (person && person.missionId === missionId) await ctx.db.patch(person._id, { missionId: undefined });
}

export async function systemLog(ctx: MutationCtx, missionId: Id<'missions'>, text: string, missionUtcMs?: number, taskId?: string) {
  return ctx.db.insert('log', { missionId, authorId: 'system', authorName: 'Mission', kind: 'system', text, missionUtcMs, taskId, createdAt: Date.now() });
}
