import type { Map as MapLibreMap } from 'maplibre-gl';
import { REGION, inBox } from '@/lib/constants';
import { useApp } from '@/store';

/** The centre of Jezero crater, and the zoom at which the whole crater fits a laptop screen. */
export const JEZERO_VIEW = { center: [77.58, 18.4] as [number, number], zoom: 9.4 };

const NO_PADDING = { left: 0, right: 0, top: 0, bottom: 0 };

export interface View {
  center: [number, number];
  zoom: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

/**
 * The opening view: the planet large, pushed to the right on a wide screen and to the top on a
 * phone, so the words have room; Jezero sits a little left of the planet's centre.
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
  const view = target ?? JEZERO_VIEW;
  app.setFlying(true);
  const done = () => {
    const s = useApp.getState();
    s.setMode('map');
    s.setFlying(false);
    s.setLanded();
  };
  if (prefersReducedMotion()) {
    map.jumpTo({ center: view.center, zoom: view.zoom, bearing: 0, pitch: 0, padding: NO_PADDING });
    done();
    return;
  }
  map.once('moveend', done);
  map.flyTo({ center: view.center, zoom: view.zoom, bearing: 0, pitch: 0, padding: NO_PADDING, duration: 6500, curve: 1.3, essential: true });
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
