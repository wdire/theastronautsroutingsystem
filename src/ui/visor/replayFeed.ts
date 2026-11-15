/**
 * Perseverance's whole drive, replayed in Rover View: the rover follows its real track from any sol to the
 * last, at a speed the visitor picks, and the view rides along as it would with a mission.
 */
import { create } from 'zustand';
import { loadTraverse, type Traverse } from '@/data/datasets';
import { bearingDeg } from '@/lib/geo';
import { pathStats } from '@/planner/geometry';
import type { MissionFeed } from '@/visor';

/** Ground speed at 1x, m/s: a brisk drive, so the whole 45 km takes minutes at the top speed, not days. */
export const REPLAY_BASE_MS = 2;
export const REPLAY_SPEEDS = [1, 5, 20, 100] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayState {
  distM: number;
  totalM: number;
  sol: number;
  speed: ReplaySpeed;
  playing: boolean;
}

export const useReplay = create<ReplayState>()(() => ({ distM: 0, totalM: 0, sol: 0, speed: 5, playing: true }));

/** The sol the rover had reached at a distance along its drive. */
function solAt(t: Traverse, distM: number): number {
  let sol = t.waypoints[0]?.sol ?? 0;
  for (const w of t.waypoints) {
    if (w.distKm * 1000 > distM) break;
    sol = w.sol;
  }
  return sol;
}

/** A feed that drives the view along the traverse, starting at `fromSol`. Resolves once the track has loaded. */
export async function replayFeed(fromSol: number): Promise<MissionFeed> {
  const t = await loadTraverse();
  const path = t.path;
  const along = pathStats(path).along;
  const total = along[along.length - 1] ?? 0;
  const start = t.waypoints.find((w) => w.sol >= fromSol);
  useReplay.setState({ distM: Math.min(total, (start?.distKm ?? 0) * 1000), totalM: total, sol: start?.sol ?? 0, playing: true });
  let last = performance.now();
  let index = 1;
  // The distance is advanced here every frame and written to the store a few times a second: each write
  // redraws the replay panel, and sixty redraws a second cost the frame for nothing the eye can read.
  let distM = useReplay.getState().distM;
  let pushed = distM;
  let pushedAt = 0;

  /** The path index whose segment holds a distance, searched from the last one (the replay moves forward). */
  const seek = (d: number): number => {
    if ((along[index - 1] ?? 0) > d) index = 1;
    while (index < path.length - 1 && (along[index] ?? 0) < d) index += 1;
    return index;
  };
  const pointAt = (d: number): { lon: number; lat: number; heading: number } => {
    const i = seek(d);
    const a = path[i - 1] ?? path[0];
    const b = path[i] ?? a;
    if (!a || !b) return { lon: 0, lat: 0, heading: 0 };
    const a0 = along[i - 1] ?? 0;
    const seg = (along[i] ?? a0) - a0;
    const f = seg > 0 ? Math.min(1, Math.max(0, (d - a0) / seg)) : 0;
    // The heading over the next few metres, so a jitter in the track does not swing the rover about.
    const ahead = path[Math.min(path.length - 1, i + 2)] ?? b;
    return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, heading: bearingDeg(a[0], a[1], ahead[0], ahead[1]) };
  };

  return {
    vehicle: 'robotRover',
    roster: [],
    crew() {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const s = useReplay.getState();
      // Moved from the panel (back to the start): take it from there.
      if (s.distM !== pushed) distM = pushed = s.distM;
      let d = distM;
      const moving = s.playing && d < total;
      if (moving) {
        d = Math.min(total, d + REPLAY_BASE_MS * s.speed * dt);
        distM = d;
        const sol = solAt(t, d);
        const done = d >= total;
        if (done || sol !== s.sol || now - pushedAt > 250) {
          pushed = d;
          pushedAt = now;
          useReplay.setState({ distM: d, ...(sol !== s.sol ? { sol } : {}), ...(done ? { playing: false } : {}) });
        }
      }
      const p = pointAt(d);
      return { lon: p.lon, lat: p.lat, headingDeg: p.heading, speedMs: moving ? REPLAY_BASE_MS * s.speed : 0, moving };
    },
    ahead() {
      const d = distM;
      const i = seek(d);
      const pts: [number, number][] = [];
      // The next 1.5 km of track: the guides draw it, and the view loads the ground under it ahead of time.
      for (let k = i; k < path.length && (along[k] ?? 0) - d < 1500; k += 1) {
        const p = path[k];
        if (p) pts.push([p[0], p[1]]);
      }
      const nextStop = t.waypoints.find((w) => w.distKm * 1000 > d + 5);
      return { path: pts, objective: nextStop ? [nextStop.lon, nextStop.lat] : null };
    },
    fast: () => useReplay.getState().speed >= 5,
    tier: () => {
      const s = useReplay.getState();
      if (!s.playing) return 0;
      return s.speed >= 20 ? 2 : s.speed >= 5 ? 1 : 0;
    },
  };
}
