import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RouteAlternative } from '@/engines/types';
import { angleDiff, bearingDeg } from '@/lib/geo';
import { flyoverEase, flyoverSeconds, pathStats, pointAlong } from '@/planner/geometry';
import { planPoints } from '@/planner/routing';
import { useApp } from '@/store';
import { getMap } from './instance';

const PITCH = 62;
/** The camera looks this far down the route, so it turns before the bend, not in it. */
const LOOK_AHEAD_M = 280;

/**
 * Flies the camera along a route: tilted, looking the way the route goes. Touching the map, Esc or
 * the returned function ends it, and the camera goes back to where it was.
 * `names` are the route's waypoints in order, the start first, matching `route.stopIndices`.
 */
export function startFlyover(map: MapLibreMap, route: RouteAlternative, names: readonly (string | undefined)[]): () => void {
  const { path, stopIndices } = route;
  const { along, distM } = pathStats(path);
  if (path.length < 2 || distM <= 0) return () => undefined;

  const before = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  // Closer for a walk, further back for a long drive.
  const zoom = Math.max(12.6, Math.min(15.2, 15.6 - Math.log2(Math.max(1, distM / 1000) / 2)));
  const durationMs = flyoverSeconds(distM) * 1000;
  const bearingAt = (d: number): number => {
    const a = pointAlong(path, along, d);
    const b = pointAlong(path, along, Math.min(distM, d + LOOK_AHEAD_M));
    return a[0] === b[0] && a[1] === b[1] ? map.getBearing() : bearingDeg(a[0], a[1], b[0], b[1]);
  };

  let raf = 0;
  let ended = false;
  let startMs = 0;
  let bearing = bearingAt(0);
  let lastMs = 0;

  const report = (d: number) => {
    let next = stopIndices.findIndex((index, i) => i > 0 && (along[index] ?? 0) > d + 1);
    if (next < 0) next = stopIndices.length - 1;
    useApp.getState().setFlyover({ next: names[next] ?? (next === stopIndices.length - 1 ? 'the end of the route' : `stop ${next}`), remainingM: Math.max(0, (along[stopIndices[next] ?? path.length - 1] ?? distM) - d), progress: d / distM });
  };

  const end = (returnCamera: boolean) => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    map.off('movestart', onUserMove);
    window.removeEventListener('keydown', onKey, true);
    useApp.getState().setFlyover(null);
    if (returnCamera) map.easeTo({ ...before, duration: 1400 });
  };
  // Only a move the visitor started carries an original event; the flight's own moves do not.
  const onUserMove = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) end(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    end(true);
  };

  const frame = (now: number) => {
    if (ended) return;
    startMs ||= now;
    const dt = Math.min(100, now - (lastMs || now));
    lastMs = now;
    const t = (now - startMs) / durationMs;
    const d = flyoverEase(t) * distM;
    const here = pointAlong(path, along, d);
    // Turn toward the way ahead at a rate that smooths the route's small kinks.
    bearing += angleDiff(bearing, bearingAt(d)) * Math.min(1, dt / 450);
    map.jumpTo({ center: [here[0], here[1]], zoom, pitch: PITCH, bearing });
    report(d);
    if (t >= 1) return end(true);
    raf = requestAnimationFrame(frame);
  };

  report(0);
  window.addEventListener('keydown', onKey, true);
  const first = path[0];
  // A short flight to the start, then along the route.
  map.easeTo({ center: first ? [first[0], first[1]] : before.center, zoom, pitch: PITCH, bearing, duration: 1300 });
  void map.once('moveend').then(() => {
    if (ended) return;
    map.on('movestart', onUserMove);
    raf = requestAnimationFrame(frame);
  });
  return () => end(true);
}

let stopCurrent: (() => void) | null = null;

/** Flies the route that is selected in the plan. Does nothing if there is none. */
export function flySelectedRoute(): void {
  const s = useApp.getState();
  const map = getMap();
  if (!map || s.route.status !== 'ready') return;
  const { alternatives, selected } = s.route;
  const route = alternatives.find((a) => a.id === selected) ?? alternatives[0];
  if (!route) return;
  stopCurrent?.();
  stopCurrent = startFlyover(map, route, planPoints(s.plan)?.names ?? []);
}

export function stopFlyover(): void {
  stopCurrent?.();
  stopCurrent = null;
}
