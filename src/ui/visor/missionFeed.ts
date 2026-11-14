import type { PathPoint } from '@/engines/types';
import { pathStats } from '@/planner/geometry';
import { crewAt } from '@/sim/world';
import { useApp } from '@/store';
import type { MissionFeed } from '@/visor';

/**
 * What the 3D view asks of a running mission each frame: where the crew is, the route ahead of them
 * and the next objective. Reads the store directly: the view runs outside React.
 */
export function missionFeed(): MissionFeed | null {
  const run = useApp.getState().world?.run;
  if (!run) return null;
  // Distances along the route, worked out once per route: a reroute brings a new path.
  let cachedFor: PathPoint[] | null = null;
  let along: Float64Array = new Float64Array(0);
  const alongOf = (path: PathPoint[]): Float64Array => {
    if (cachedFor !== path) {
      cachedFor = path;
      along = pathStats(path).along;
    }
    return along;
  };

  // The crew as the mission's roster has it; alone, the visitor walks by themself.
  const roster = useApp.getState().roster;
  const crew = roster && roster.length > 0 ? roster.map((m) => ({ ...m })) : [{ id: 'me', name: 'You', role: 'Commander', color: '#e8743b', android: false, me: true }];
  return {
    vehicle: run.vehicle,
    roster: crew,
    crew() {
      const w = useApp.getState().world;
      if (!w?.run) return null;
      const c = crewAt(w.run, w.utcMs);
      const held = w.paused || w.run.status !== 'running';
      return { lon: c.lon, lat: c.lat, headingDeg: c.headingDeg, speedMs: c.speedMs * w.speed, moving: c.state === 'move' && !held };
    },
    ahead() {
      const w = useApp.getState().world;
      if (!w?.run) return { path: [], objective: null };
      const { path, stopIndices } = w.run;
      const c = crewAt(w.run, w.utcMs);
      const a = alongOf(path);
      // At the end of the route, or once the mission is over, there is nowhere left to point.
      if (w.run.status !== 'running' || c.distM >= (a[a.length - 1] ?? 0) - 0.5) return { path: [], objective: null };
      // The first route point still ahead of the crew.
      let i = 0;
      let lo = 0;
      let hi = a.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((a[mid] ?? 0) <= c.distM) lo = mid + 1;
        else {
          i = mid;
          hi = mid - 1;
        }
      }
      const next = stopIndices.find((index, k) => k > 0 && index >= i);
      const objective = next === undefined ? undefined : path[next];
      // Guides run to the next objective and no further: one leg at a time.
      const end = Math.min(path.length, (next ?? path.length - 1) + 1, i + 160);
      const ahead: [number, number][] = [[c.lon, c.lat]];
      for (let k = i; k < end; k += 1) {
        const p = path[k];
        if (p) ahead.push([p[0], p[1]]);
      }
      return { path: ahead, objective: objective ? [objective[0], objective[1]] : null };
    },
    fast: () => (useApp.getState().world?.speed ?? 1) >= 5,
  };
}
