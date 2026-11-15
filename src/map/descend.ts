/**
 * Zooming past the map's closest view sets the visitor down on the ground: Rover View opens where the map
 * was looking, from the map's own height and heading, and comes down to eye level. The push is gathered
 * over a few wheel notches, so a scroll that only meant to reach the closest map view does not jump.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';
import { isInRegion } from './camera';
import { getMap } from './instance';

/** At or past this zoom, further zooming in pushes toward the ground. */
export const DESCEND_ZOOM = 18.85;
/** Wheel delta, in CSS pixels, that a push needs: two or three notches of a mouse wheel (50 to 120 px each). */
const PUSH_PX = 260;

let progress = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** How far the current push has got, 0 to 1. */
export const descendProgress = (): number => progress;
export function onDescendProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How high above the ground the map's camera is, m, roughly: the height the 3D view should start at. */
function cameraHeightM(map: MapLibreMap): number {
  const canvas = map.getCanvas();
  const h = canvas.clientHeight || 800;
  const center = map.getCenter();
  // Metres per pixel at this zoom on Mars (3,396 km radius, 512 px tiles in MapLibre's frame).
  const mpp = (2 * Math.PI * 3_396_190 * Math.cos((center.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  // A 36.87 degree field of view: the camera stands 1.5 screen heights back from what it shows.
  return Math.min(150, Math.max(40, mpp * h * 1.5 * Math.cos((map.getPitch() * Math.PI) / 180)));
}

/** Opens Rover View at the middle of the map, as seen from the map's camera. */
export function standOnGround(map: MapLibreMap): void {
  const c = map.getCenter();
  if (!isInRegion(c.lng, c.lat)) return;
  progress = 0;
  emit();
  useApp.getState().openVisor({
    lon: c.lng,
    lat: c.lat,
    // The map's pitch is from straight down; the view's is from the horizon.
    arrive: { headingDeg: map.getBearing(), pitchDeg: -(90 - map.getPitch()), liftM: cameraHeightM(map) },
  });
}

export function addDescend(map: MapLibreMap): () => void {
  const container = map.getCanvasContainer();
  let decay = 0;
  const reset = () => {
    if (progress === 0) return;
    progress = 0;
    emit();
  };
  const onWheel = (e: WheelEvent) => {
    const s = useApp.getState();
    if (s.mode !== 'map' || s.visor || s.flying) return;
    if (map.getZoom() < DESCEND_ZOOM || e.deltaY >= 0) {
      reset();
      return;
    }
    const c = map.getCenter();
    if (!isInRegion(c.lng, c.lat)) return;
    // Trackpads send many small deltas, wheels a few large ones; both add up to the same push.
    const px = Math.abs(e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
    progress = Math.min(1, progress + px / PUSH_PX);
    emit();
    window.clearTimeout(decay);
    if (progress >= 1) {
      standOnGround(map);
      return;
    }
    // A pause lets go of the push.
    decay = window.setTimeout(reset, 700);
  };
  // Zooming out, or panning away, ends a push in progress.
  const onZoom = () => {
    if (map.getZoom() < DESCEND_ZOOM) reset();
  };
  container.addEventListener('wheel', onWheel, { passive: true });
  map.on('zoom', onZoom);
  return () => {
    window.clearTimeout(decay);
    container.removeEventListener('wheel', onWheel);
    map.off('zoom', onZoom);
  };
}

/** Leaving Rover View upward: the map opens at its closest view over the spot, facing the way the view did. */
export function returnToMap(lon: number, lat: number, headingDeg: number): void {
  const map = getMap();
  if (!map || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const bearing = Number.isFinite(headingDeg) ? headingDeg : map.getBearing();
  // While Rover View was open the map was folded to a single pixel, and it unfolds a frame or two after the view
  // closes. A tilted camera placed on a one-pixel map could leave the map's matrices broken for good (nothing
  // drew, no gesture brought it back), so the jump waits until the map has its size again.
  const started = performance.now();
  const go = () => {
    const canvas = map.getContainer();
    if ((canvas.clientWidth < 100 || canvas.clientHeight < 100) && performance.now() - started < 2000) {
      requestAnimationFrame(go);
      return;
    }
    map.resize();
    map.jumpTo({ center: [lon, lat], zoom: DESCEND_ZOOM - 0.05, bearing, pitch: Math.min(map.getPitch(), 50) });
    map.easeTo({ zoom: DESCEND_ZOOM - 1.4, duration: 1100 });
  };
  requestAnimationFrame(go);
}
