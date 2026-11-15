/**
 * Whether the plan in hand can be flown as a mission, and if not, why. Every Start in the app (the planner, the
 * crew room, the console hooks) asks this one function, so a plan that is refused in one place is refused in all.
 */
import { checkFleet, fleetOf, peopleOf } from '@/engines/fleet';
import type { AppState } from '@/store';

type StartInput = Pick<AppState, 'plan' | 'route' | 'world' | 'roster'>;

/** The first reason the mission cannot start as it stands, in words for the visitor; null when it can. */
export function startProblem(s: StartInput): string | null {
  if (s.world?.run?.status === 'running') return 'A mission is already under way.';
  if (!s.plan.start) return 'Choose where the mission starts.';
  if (s.plan.stops.length === 0) return 'Add a stop to go to.';
  if (s.route.status === 'routing' || s.route.status === 'idle') return 'Working out the route…';
  if (s.route.status === 'failed') return 'No route was found. Change the plan until one is.';
  const route = s.route;
  if (!route.hasBudget) return 'The trip budget did not load, so the mission cannot be costed.';
  const chosen = route.alternatives.find((a) => a.id === route.selected) ?? route.alternatives[0];
  if (!chosen) return 'No route was found. Change the plan until one is.';
  // On a crew mission the crew list is the head count; the plan catches up with it a moment after a change.
  const people = s.roster ? s.roster.length : peopleOf(s.plan);
  const fleetProblem = checkFleet(fleetOf(s.plan), people).problems[0];
  if (fleetProblem) return fleetProblem;
  if (s.roster && s.roster.length !== peopleOf(s.plan)) return 'Costing the plan for the crew as it stands now…';
  if (!chosen.trip.feasible) return 'This plan does not work as it stands: something runs out before the crew is back. Change it until it does.';
  return null;
}
