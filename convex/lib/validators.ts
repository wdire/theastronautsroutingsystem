/** Validators the schema and the functions share, so a stored value and an accepted argument never drift apart. */
import { v } from 'convex/values';
import { ANDROID_COLOR } from '../shared';

export const suitColorV = v.union(
  v.literal('signal'),
  v.literal('flare'),
  v.literal('ochre'),
  v.literal('lichen'),
  v.literal('glacier'),
  v.literal('cobalt'),
  v.literal('iris'),
  v.literal('chalk'),
);
export const crewColorV = v.union(suitColorV, v.literal(ANDROID_COLOR));

export const viewV = v.union(v.literal('map'), v.literal('rover'));
export const whereV = v.object({ lon: v.number(), lat: v.number(), headingDeg: v.number(), moving: v.boolean() });

export const statusV = v.union(v.literal('planning'), v.literal('underway'), v.literal('complete'), v.literal('aborted'));
export const crewKindV = v.union(v.literal('human'), v.literal('android'));
export const crewStateV = v.union(v.literal('invited'), v.literal('joined'), v.literal('left'));
export const logKindV = v.union(v.literal('note'), v.literal('radio'), v.literal('system'), v.literal('task'));

/** Who is asking. The secret never leaves the browser except to be checked here. */
export const authV = v.object({ clientId: v.string(), secret: v.string() });
