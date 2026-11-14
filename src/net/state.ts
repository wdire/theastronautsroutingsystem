/**
 * What the rest of the app needs to know about the crew, kept apart from the Convex client so the planner and
 * the run panel can read it without loading the network code. The net layer (NetRoot) fills it in; with no
 * crew server configured it stays empty and every panel behaves as it does solo.
 */
import { create } from 'zustand';
import type { Id } from '../../convex/_generated/dataModel';
import type { SuitColor } from '../../convex/shared';
import { NET_ENABLED } from './config';

export type MissionStatus = 'planning' | 'underway' | 'complete' | 'aborted';

export interface CrewLogEntry {
  id: string;
  authorId: string;
  authorName: string;
  kind: 'note' | 'radio' | 'system' | 'task';
  text: string;
  missionUtcMs: number | null;
  createdAt: number;
}

export interface CurrentMission {
  id: Id<'missions'>;
  title: string;
  status: MissionStatus;
  isCommander: boolean;
}

export interface CrewState {
  enabled: boolean;
  /** The visitor as others see them, once registered. */
  me: { clientId: string; name: string; color: SuitColor } | null;
  /** The planning or underway mission the visitor is crew of. */
  current: CurrentMission | null;
  /** A mission that ended while the visitor was on it, so its end card can offer the debrief. */
  ended: Id<'missions'> | null;
  /** A member's view of the run: the commander's browser has not been heard from lately. */
  linkStale: boolean;
  /** The shared crew log of the current mission, oldest first. */
  log: CrewLogEntry[];
  /** The debrief being read, if any. */
  debriefId: Id<'missions'> | null;
  /** Sends a radio call to the crew log. Set by the net layer while a mission is on. */
  radio: ((text: string) => void) | null;
  /** Starts the current mission for the whole crew. Set while the visitor commands one that is being planned. */
  start: (() => Promise<boolean>) | null;
}

export const useCrew = create<CrewState>()(() => ({
  enabled: NET_ENABLED,
  me: null,
  current: null,
  ended: null,
  linkStale: false,
  log: [],
  debriefId: null,
  radio: null,
  start: null,
}));

/** True when someone else commands the mission the visitor is in: the plan and the run are theirs to change. */
export function isMember(s: CrewState): boolean {
  return s.current !== null && !s.current.isCommander;
}

/** The planner is read-only for crew members while the commander plans. */
export function planLocked(s: CrewState): boolean {
  return s.current !== null && !s.current.isCommander && s.current.status === 'planning';
}

/** A member watching the commander's run: speed, pause and alerts are the commander's. */
export function watchingRun(s: CrewState): boolean {
  return s.current !== null && !s.current.isCommander && s.current.status === 'underway';
}

declare global {
  interface Window {
    /** The crew state, for the demo console and the tests. */
    __areoCrew?: typeof useCrew;
  }
}
if (typeof window !== 'undefined') window.__areoCrew = useCrew;
