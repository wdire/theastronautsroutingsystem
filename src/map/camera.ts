import type { Map as MapLibreMap } from 'maplibre-gl';
import { REGION, inBox } from '@/lib/constants';
import { useApp } from '@/store';
import { flightPitch } from './tilt';
import { warmView } from './warm';

/** The centre of Jezero crater, and the zoom at which the whole crater fits a laptop screen. */
export const JEZERO_VIEW = { center: [77.58, 18.4] as [number, number], zoom: 9.4 };

/**
 * Where the flight from the planet comes down: over the delta and the crater rim Perseverance has driven,
 * close enough to read its track, tilted so the delta's fronts and the rim stand up.
 */
export const LANDING_VIEW = { center: [77.37, 18.462] as [number, number], zoom: 13.3, bearing: -12 };

const NO_PADDING = { left: 0, right: 0, top: 0, bottom: 0 };

export interface View {
  center: [number, number];
  zoom: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

/**
 * The opening view: the planet large, pushed to the right on a wide screen and to the top on a
 * phone, so the words have room; Jezero sits a little left of the planet’s centre.
 */
export function globeView(width = window.innerWidth, height = window.innerHeight): View {
  const wide = width >= 900;
  const diameter = wide ? Math.min(height * 0.94, width * 0.62) : Math.min(width * 0.96, height * 0.5);
  // The globe is 432 px across at zoom 1.6 and doubles with every zoom level.
  const zoom = 1.6 + Math.log2(Math.max(160, diameter) / 432);
  const padding = wide
    ? { ...NO_PADDING, left: Math.round(width * 0.3) }
    : { ...NO_PADDING, bottom: Math.round(height * 0.4) };
  return { center: [89, 12], zoom, padding };
}

/** Degrees of longitude per second while the planet turns on the opening screen. */
const SPIN_DEG_PER_S = 0.22;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Turns the planet slowly while the opening screen shows and nobody is touching it. */
export function startGlobeSpin(map: MapLibreMap): () => void {
  let raf = 0;
  let last = performance.now();
  let touching = false;
  let resumeAt = 0;
  const down = () => {
    touching = true;
  };
  const up = () => {
    touching = false;
    resumeAt = performance.now() + 2500;
  };
  map.on('mousedown', down);
  map.on('touchstart', down);
  map.on('mouseup', up);
  map.on('touchend', up);
  map.on('wheel', up);
  const onResize = () => {
    const s = useApp.getState();
    if (s.mode !== 'globe' || s.flying) return;
    const view = globeView();
    map.jumpTo({ zoom: view.zoom, padding: view.padding });
  };
  window.addEventListener('resize', onResize);

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = useApp.getState();
    if (s.mode === 'globe' && !s.flying && !touching && now > resumeAt && !prefersReducedMotion() && !document.hidden) {
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng - SPIN_DEG_PER_S * dt, c.lat] });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    map.off('mousedown', down);
    map.off('touchstart', down);
    map.off('mouseup', up);
    map.off('touchend', up);
    map.off('wheel', up);
  };
}

/** One continuous flight from the planet down to the region. */
export function flyIn(map: MapLibreMap, target?: { center: [number, number]; zoom: number }): void {
  const app = useApp.getState();
  if (app.flying || app.mode === 'map') return;
  const view = target ?? LANDING_VIEW;
  const bearing = target ? 0 : LANDING_VIEW.bearing;
  const pitch = flightPitch(view.zoom);
  app.setFlying(true);
  // The ground at the landing loads during the flight, so it is sharp when the camera arrives.
  warmView(view.center, view.zoom);
  const done = () => {
    const s = useApp.getState();
    s.setMode('map');
    s.setFlying(false);
    s.setLanded();
  };
  if (prefersReducedMotion()) {
    map.jumpTo({ center: view.center, zoom: view.zoom, bearing, pitch, padding: NO_PADDING });
    done();
    return;
  }
  map.once('moveend', done);
  map.flyTo({ center: view.center, zoom: view.zoom, bearing, pitch, padding: NO_PADDING, duration: 7200, curve: 1.42, essential: true });
}

/** The way back: out to the whole planet. */
export function flyOut(map: MapLibreMap): void {
  const app = useApp.getState();
  if (app.flying || app.mode === 'globe') return;
  app.setFlying(true);
  app.setMode('globe');
  const view = globeView();
  const done = () => useApp.getState().setFlying(false);
  if (prefersReducedMotion()) {
    map.jumpTo({ ...view, bearing: 0, pitch: 0 });
    done();
    return;
  }
  map.once('moveend', done);
  map.flyTo({ ...view, bearing: 0, pitch: 0, duration: 5200, curve: 1.3, essential: true });
}

export function isInRegion(lon: number, lat: number): boolean {
  return inBox(REGION, lon, lat);
}

/**
 * When a mission starts: come down close over the crew at the start, tilted along the way out, and load the
 * first stretch of the route ahead so it is sharp as they walk or drive into it.
 */
export function focusRunStart(map: MapLibreMap, path: readonly (readonly [number, number, ...number[]])[]): void {
  const first = path[0];
  if (!first) return;
  const zoom = 15.6;
  // Face the way out: toward a point a few hundred metres along.
  const ahead = path[Math.min(path.length - 1, 40)] ?? first;
  const bearing = (Math.atan2((ahead[0] - first[0]) * Math.cos((first[1] * Math.PI) / 180), ahead[1] - first[1]) * 180) / Math.PI;
  for (const i of [0, Math.floor(path.length * 0.08), Math.floor(path.length * 0.18)]) {
    const p = path[i];
    if (p) warmView([p[0], p[1]], zoom);
  }
  map.flyTo({ center: [first[0], first[1]], zoom, pitch: flightPitch(zoom), bearing: Number.isFinite(bearing) ? bearing : map.getBearing(), duration: prefersReducedMotion() ? 0 : 2200, essential: true });
}

/** Brings the camera to the crew whenever a mission starts here or on the commander's browser. */
export function addRunFocus(map: MapLibreMap): () => void {
  return useApp.subscribe(
    (s) => s.world?.run?.id ?? null,
    (id, prev) => {
      const run = useApp.getState().world?.run;
      if (!id || id === prev || !run || run.status !== 'running') return;
      focusRunStart(map, run.path);
    },
  );
}
