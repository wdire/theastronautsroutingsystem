import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { crewColorV, crewKindV, crewStateV, logKindV, statusV, suitColorV, viewV, whereV } from './lib/validators';

export default defineSchema({
  // One row per browser. clientId is public; only a hash of the secret is kept.
  people: defineTable({
    clientId: v.string(),
    secretHash: v.string(),
    name: v.string(),
    color: suitColorV,
    online: v.boolean(),
    lastSeen: v.number(),
    view: viewV,
    where: v.optional(whereV),
    // The planning or underway mission this person is crew of. Kept here so "one mission at a time" is one read.
    missionId: v.optional(v.id('missions')),
  })
    .index('by_clientId', ['clientId'])
    .index('by_online_and_lastSeen', ['online', 'lastSeen']),

  // Kept small on purpose: the plan and the debrief live in their own tables, so listing missions stays cheap.
  missions: defineTable({
    title: v.string(),
    objective: v.string(),
    commanderId: v.string(),
    status: statusV,
    plannedStartUtc: v.optional(v.number()),
    planRev: v.number(),
    vehicle: v.string(),
    siteName: v.optional(v.string()),
    open: v.boolean(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    assignments: v.record(v.string(), v.id('crew')),
  }).index('by_status', ['status']),

  plans: defineTable({ missionId: v.id('missions'), planJson: v.string() }).index('by_missionId', ['missionId']),
  debriefs: defineTable({ missionId: v.id('missions'), debriefJson: v.string() }).index('by_missionId', ['missionId']),

  crew: defineTable({
    missionId: v.id('missions'),
    kind: crewKindV,
    personId: v.optional(v.string()),
    name: v.string(),
    role: v.string(),
    color: crewColorV,
    state: crewStateV,
    joinedAt: v.number(),
    order: v.number(),
    // Set when the mission ends, so a person's history is one index range, newest first.
    endedAt: v.optional(v.number()),
  })
    .index('by_missionId_and_order', ['missionId', 'order'])
    .index('by_missionId_and_personId', ['missionId', 'personId'])
    .index('by_personId_and_state', ['personId', 'state'])
    .index('by_personId_and_endedAt', ['personId', 'endedAt']),

  // Rewritten about once a second during a run, so it holds only the snapshot. The route sits apart in routes.
  live: defineTable({
    missionId: v.id('missions'),
    snapshotJson: v.string(),
    routeRev: v.number(),
    updatedAt: v.number(),
  }).index('by_missionId', ['missionId']),

  routes: defineTable({ missionId: v.id('missions'), routeRev: v.number(), routeJson: v.string() }).index('by_missionId', ['missionId']),

  log: defineTable({
    missionId: v.id('missions'),
    authorId: v.string(),
    authorName: v.string(),
    kind: logKindV,
    text: v.string(),
    missionUtcMs: v.optional(v.number()),
    taskId: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_missionId', ['missionId']),

  // The one base every visitor shares: a single row, absent until someone first moves it from the default spot.
  bases: defineTable({
    key: v.literal('main'),
    lon: v.number(),
    lat: v.number(),
    name: v.string(),
    movedById: v.string(),
    movedByName: v.string(),
    movedAt: v.number(),
  }).index('by_key', ['key']),

  notes: defineTable({
    missionId: v.id('missions'),
    authorId: v.string(),
    text: v.string(),
    missionUtcMs: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_missionId_and_authorId', ['missionId', 'authorId']),
});
