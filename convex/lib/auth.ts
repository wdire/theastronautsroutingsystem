/**
 * There is no login. A browser proves it is the same person by sending the secret it made on first visit;
 * the server keeps only a SHA-256 of it. Names and roles a client sends are never used to decide who may act.
 */
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type Ctx = QueryCtx | MutationCtx;
type Status = Doc<'missions'>['status'];

export async function hashSecret(clientId: string, secret: string): Promise<string> {
  // Salting with the clientId means two browsers that somehow drew the same secret still hash apart.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${clientId}:${secret}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function findPerson(ctx: Ctx, clientId: string): Promise<Doc<'people'> | null> {
  return ctx.db
    .query('people')
    .withIndex('by_clientId', (q) => q.eq('clientId', clientId))
    .unique();
}

/** For queries: a bad or missing secret reads as "nobody", so a screen shows empty rather than crashing. */
export async function checkPerson(ctx: Ctx, clientId: string | undefined, secret: string | undefined): Promise<Doc<'people'> | null> {
  if (!clientId || !secret) return null;
  const person = await findPerson(ctx, clientId);
  if (!person || person.secretHash !== (await hashSecret(clientId, secret))) return null;
  return person;
}

/** For mutations: anything short of a matching secret stops the call. */
export async function requirePerson(ctx: Ctx, clientId: string, secret: string): Promise<Doc<'people'>> {
  const person = await findPerson(ctx, clientId);
  if (!person) throw new ConvexError('This browser is not registered yet. Reload the page and try again.');
  if (person.secretHash !== (await hashSecret(clientId, secret))) {
    throw new ConvexError('This browser’s key does not match its name. Clear the site data to start fresh.');
  }
  return person;
}

export async function requireMission(ctx: Ctx, missionId: Id<'missions'>): Promise<Doc<'missions'>> {
  const mission = await ctx.db.get(missionId);
  if (!mission) throw new ConvexError('That mission no longer exists.');
  return mission;
}

export async function requireCommander(ctx: Ctx, missionId: Id<'missions'>, person: Doc<'people'>): Promise<Doc<'missions'>> {
  const mission = await requireMission(ctx, missionId);
  if (mission.commanderId !== person.clientId) throw new ConvexError('Only the commander can do that.');
  return mission;
}

const STATUS_WORDS: Record<Status, string> = {
  planning: 'still being planned',
  underway: 'underway',
  complete: 'complete',
  aborted: 'over',
};

export function requireStatus(mission: Doc<'missions'>, allowed: readonly Status[]): void {
  if (allowed.includes(mission.status)) return;
  throw new ConvexError(`That can't be done while the mission is ${STATUS_WORDS[mission.status]}.`);
}

export function isActive(mission: Doc<'missions'> | null): mission is Doc<'missions'> {
  return mission !== null && (mission.status === 'planning' || mission.status === 'underway');
}
