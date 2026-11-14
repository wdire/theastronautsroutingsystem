import { toast } from 'sonner';
import { groundAt } from '@/data/dem';
import { useApp } from '@/store';
import { baseSpotProblem } from './base';

/** Moves the base to a picked point, if the ground there will take one. The old base is one Undo away. */
export async function moveBaseTo(lon: number, lat: number): Promise<void> {
  const slope = await groundAt(lon, lat).then((g) => g.slopeDeg).catch(() => null);
  const problem = baseSpotProblem(lon, lat, slope);
  if (problem) {
    toast('The base cannot go there', { description: problem });
    return;
  }
  const app = useApp.getState();
  if (app.world?.run?.status === 'running') {
    toast('The base cannot move during a mission', { description: 'End the mission first.' });
    return;
  }
  const before = app.base;
  app.setBase({ ...before, lon, lat });
  toast(`${before.name} moved`, { description: 'Missions now start and end here.', action: { label: 'Undo', onClick: () => useApp.getState().setBase(before) } });
}
