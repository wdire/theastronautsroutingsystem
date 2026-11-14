/**
 * The run events worth a line in the crew log, found by comparing the world before and after a tick: an alert
 * raised, a route changed, a task done or skipped, the mission over. The commander's browser writes them, so
 * every crew member's log and the debrief tell the same story.
 */
import type { World } from '@/sim/types';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { alertLine, planTaskId } from './debrief';

export interface RunEvent {
  text: string;
  missionUtcMs: number;
  /** The plan's task id, for a task update. */
  taskId?: string;
}

export function runEvents(prev: World | null, next: World, assigneeOf: (planTaskId: string) => string | null = () => null): RunEvent[] {
  const run = next.run;
  if (!run) return [];
  // A world seen for the first time (a reload, another run) reports nothing: what came before is logged already.
  if (!prev?.run || prev.run.id !== run.id) return [];
  const before = prev.run;
  const out: RunEvent[] = [];

  const seen = new Set(prev.alerts.map((a) => a.id));
  for (const a of next.alerts) if (!seen.has(a.id)) out.push({ text: alertLine(a), missionUtcMs: a.atUtcMs });

  if (run.leg > before.leg) {
    out.push({ text: `Route changed. The new route is ${fmtDistance(run.trip.totals.distM)}, about ${fmtDuration(run.trip.totals.durationS)}.`, missionUtcMs: run.legStartUtcMs });
  }

  const was = new Map(before.tasks.map((t) => [t.id, t.state]));
  for (const t of run.tasks) {
    if ((t.state !== 'done' && t.state !== 'skipped') || was.get(t.id) === t.state) continue;
    const id = planTaskId(t.id);
    const who = assigneeOf(id);
    out.push({ text: `${t.state === 'done' ? 'Done' : 'Skipped'}: ${t.label} at ${t.stopName}${who ? ` (${who})` : ''}.`, missionUtcMs: next.utcMs, taskId: id });
  }

  if (before.status === 'running' && run.status !== 'running' && run.outcome) {
    out.push({ text: `Mission over. ${run.outcome.text}`, missionUtcMs: run.outcome.atUtcMs });
  }
  return out;
}
