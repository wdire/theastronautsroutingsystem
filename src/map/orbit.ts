import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';
import { holdTilt } from './tilt';

/**
 * A place found in search is shown the way a 3D map shows a landmark: the camera comes down to it, leaning in
 * at about 45 degrees, and circles it slowly. The first touch, drag, wheel or key hands the camera back.
 */

/** Degrees of bearing per second: one turn in a little over a minute. */
const DEG_PER_S = 5;
/** The lean while circling, degrees from straight down. */
const ORBIT_PITCH = 50;
/** Seconds to come up to full speed, so the turn starts gently. */
const RAMP_S = 2.5;

/** Every camera move this module makes carries this flag, so its own moves never stop it. */
const OWN = { areoOrbit: true };

let stopCurrent: (() => void) | null = null;

const ours = (e: object) => (e as { areoOrbit?: boolean }).areoOrbit === true;

export function isOrbiting(): boolean {
  return stopCurrent !== null;
}

export function stopOrbit(): void {
  stopCurrent?.();
}

/** Flies to a place and circles it until the visitor takes the camera. */
export function orbitTo(map: MapLibreMap, center: [number, number], zoom: number, duration: number): void {
  stopOrbit();
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    map.flyTo({ center, zoom, duration: 0 });
    return;
  }

  let raf = 0;
  let circling = false;
  let started = 0;
  let last = 0;
  const frame = (now: number) => {
    const s = useApp.getState();
    if (s.mode !== 'map' || s.flyover || document.hidden) {
      raf = requestAnimationFrame(frame);
      last = now;
      return;
    }
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const ramp = Math.min(1, (now - started) / 1000 / RAMP_S);
    const speed = DEG_PER_S * ramp * ramp * (3 - 2 * ramp);
    map.jumpTo({ bearing: map.getBearing() + speed * dt }, OWN);
    raf = requestAnimationFrame(frame);
  };

  const onArrive = (e: object) => {
    if (!ours(e) || circling || stopCurrent !== stop) return;
    circling = true;
    started = performance.now();
    raf = requestAnimationFrame(frame);
  };
  // Anything that moves the camera without the flag (a drag, the wheel, a button, another flight) ends it.
  const onMoveStart = (e: object) => {
    if (!ours(e)) stop();
  };
  const onTouch = () => stop();
  const canvas = map.getCanvasContainer();

  function stop() {
    if (stopCurrent !== stop) return;
    stopCurrent = null;
    // The lean stays as it was when the visitor took over, rather than easing back to the zoom's.
    holdTilt();
    cancelAnimationFrame(raf);
    map.off('moveend', onArrive);
    map.off('movestart', onMoveStart);
    canvas.removeEventListener('pointerdown', onTouch, true);
    canvas.removeEventListener('wheel', onTouch, true);
    canvas.removeEventListener('keydown', onTouch, true);
  }

  stopCurrent = stop;
  map.on('moveend', onArrive);
  map.on('movestart', onMoveStart);
  canvas.addEventListener('pointerdown', onTouch, true);
  canvas.addEventListener('wheel', onTouch, { capture: true, passive: true });
  canvas.addEventListener('keydown', onTouch, true);
  map.flyTo({ center, zoom, pitch: ORBIT_PITCH, duration, essential: true }, OWN);
}
