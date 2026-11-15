import { sortAlerts } from '@/engines/alerts';
import type { CrewSnapshot } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import type { MissionRun } from '@/sim/types';
import { useApp } from '@/store';

/** One line for what the crew is doing now. */
export function stateWords(run: MissionRun, crew: CrewSnapshot, next: string): string {
  const v = VEHICLES[run.vehicle];
  const doing = run.tasks.find((t) => t.state === 'doing');
  switch (crew.state) {
    case 'work':
      return doing ? `${doing.label} at ${doing.stopName}` : 'Working';
    case 'wait':
      return 'Waiting for daylight';
    case 'camp':
      return 'Camped for the night';
    case 'done':
      return 'Mission over';
    default:
      return `${v.kind === 'walk' ? 'Walking' : v.kind === 'air' ? 'Flying' : 'Driving'} to ${next}`;
  }
}


/** The open alerts, most severe first, and the one to show: the one a proposed route answers, else the worst. */
export function useOpenAlert() {
  const alerts = useApp((s) => s.world?.alerts);
  const proposed = useApp((s) => s.proposed);
  const open = sortAlerts((alerts ?? []).filter((a) => !a.resolved));
  const alert = proposed ? open.find((a) => a.id === proposed.alertId) : open[0];
  return { alert, open };
}

