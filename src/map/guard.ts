import { LngLat as LngLatClass, type LngLat, type Map as MapLibreMap } from 'maplibre-gl';

/**
 * Keeps the map's camera somewhere it can see from. The library raises a camera that has gone into the terrain
 * only on a flat map; on the globe it leaves it there, and close in, leaning steeply toward a hill (the relief
 * is stretched for reading), a zoom or a return from Rover View could put the camera inside the ground. From
 * there nothing drew but sky and the planet's colour, and no gesture got it out. After every move the camera is
 * checked against the ground under it and just ahead of it, and lifted clear when it is not, keeping the point
 * it looks at. A camera whose numbers have gone bad (not finite) goes back to the last good view.
 */

/** Every move this module makes carries this flag, so other listeners can tell it from the visitor's. */
const OWN = { areoGuard: true };
/** Checks while the camera moves, at most this often, ms. */
const EVERY_MS = 80;

interface View {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

const stats = { lifted: 0, restored: 0 };
declare global {
  interface Window {
    __areoGuard?: typeof stats;
  }
}

/** A point `t` of the way from `a` to `b`, in degrees: near enough for points a few hundred metres apart. */
function toward(a: LngLat, b: LngLat, t: number): [number, number] {
  return [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t];
}

export function addCameraGuard(map: MapLibreMap): () => void {
  if (typeof window !== 'undefined') window.__areoGuard = stats;
  let good: View | null = null;
  let lastCheck = 0;
  let busy = false;

  const read = (): View | null => {
    let c: LngLat;
    try {
      c = map.getCenter();
    } catch {
      return null;
    }
    const view: View = { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    if (![...view.center, view.zoom, view.pitch, view.bearing].every(Number.isFinite)) return null;
    // The point the camera looks at must project to somewhere on or near the screen. When the camera's matrices
    // have gone wrong it projects to nothing (not a number) or wildly off, tiles stop drawing and the labels gather
    // in a corner. The test is loose on purpose: in a flight, or while the ground under the middle loads, the
    // point can sit well off the middle for a moment, and treating that as broken sent the camera back to an
    // old view mid-flight.
    try {
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const p = map.getPadding();
      const pad = { left: p.left ?? 0, right: p.right ?? 0, top: p.top ?? 0, bottom: p.bottom ?? 0 };
      const at = map.project(c);
      const dx = at.x - (pad.left + (w - pad.left - pad.right) / 2);
      const dy = at.y - (pad.top + (h - pad.top - pad.bottom) / 2);
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
      // Not while the map is folded away under Rover View, or too small for its padding to leave a middle.
      const roomy = w > 320 && h > 240 && pad.left + pad.right < w * 0.8 && pad.top + pad.bottom < h * 0.8;
      if (roomy && Math.hypot(dx, dy) > Math.max(w, h) * 3) return null;
    } catch {
      return null;
    }
    return view;
  };

  /** The library's own camera state, set straight: its moves read the broken state first and throw on it. */
  type Settable = { setZoom?: (z: number) => void; setPitch?: (p: number) => void; setBearing?: (b: number) => void; setCenter?: (c: LngLat) => void };
  const inner = map as unknown as { _camera?: { transform?: Settable } };

  /**
   * Puts the camera back on the last good view, or a plain one over the same place looking straight down. Each
   * part is set on its own, so one part that still throws does not stop the rest, and then the view is moved
   * there the ordinary way so every listener hears of it.
   */
  const repair = () => {
    let here: [number, number] = [77.44, 18.43];
    try {
      const c = map.getCenter();
      if (Number.isFinite(c.lng) && Number.isFinite(c.lat)) here = [c.lng, c.lat];
    } catch {
      // The plain view's default place.
    }
    const fallback: View = { center: here, zoom: 14, pitch: 0, bearing: 0 };
    for (const target of good ? [good, fallback] : [fallback]) {
      const tr = inner._camera?.transform;
      for (const set of [() => tr?.setPitch?.(target.pitch), () => tr?.setBearing?.(target.bearing), () => tr?.setZoom?.(target.zoom), () => tr?.setCenter?.(new LngLatClass(target.center[0], target.center[1]))]) {
        try {
          set();
        } catch {
          // The next part may still go through.
        }
      }
      try {
        map.jumpTo(target, OWN);
      } catch {
        // Try the plain view.
      }
      if (read()) return;
    }
  };

  // Repairs are spaced, and a camera that will not come right after a few in a row is left alone: a guard that
  // repaired every frame would itself freeze the page.
  let lastRepair = 0;
  let repairsInRow = 0;
  const mayRepair = (): boolean => {
    const now = performance.now();
    if (now - lastRepair > 10_000) repairsInRow = 0;
    if (now - lastRepair < 1000 || repairsInRow >= 3) return false;
    lastRepair = now;
    repairsInRow += 1;
    return true;
  };

  const check = (settled: boolean) => {
    if (busy || map.isMoving()) return;
    // Folded away under Rover View, the map is not looked at: nothing to guard.
    const canvas = map.getCanvas();
    if (canvas.clientWidth < 320 || canvas.clientHeight < 240) return;
    const view = read();
    if (!view && !mayRepair()) return;
    if (!view) {
      // Bad numbers: nothing can be drawn from here, and the library will not find its way back. The last good
      // view, or failing that a plain one over the same place, looking straight down.
      busy = true;
      stats.restored += 1;
      try {
        repair();
      } finally {
        busy = false;
      }
      return;
    }
    if (settled) good = view;
    if (!map.getTerrain()) return;
    // The library keeps the camera's own place internal (in this version on its camera object); it is read, never
    // changed, here, and the guard stands down if a later version moves it.
    type Readable = { getCameraLngLat?: () => LngLat; getCameraAltitude?: () => number; elevation?: number };
    const inner = map as unknown as { _camera?: { transform?: Readable }; transform?: Readable };
    const tr = inner._camera?.transform ?? inner.transform;
    if (!tr?.getCameraLngLat || !tr.getCameraAltitude) return;
    // How far the camera is above the drawn ground under it and a little way toward what it looks at (relief
    // stretch included), less the clearance it needs: a few metres close in, more from higher up.
    const margin = (): number | null => {
      const camera = tr.getCameraLngLat?.();
      const altitude = tr.getCameraAltitude?.();
      if (!camera || altitude === undefined || !Number.isFinite(altitude)) return null;
      const center = map.getCenter();
      let ground = -Infinity;
      for (const t of [0, 0.04, 0.1]) {
        const h = map.queryTerrainElevation(toward(camera, center, t));
        if (h !== null && h !== undefined && Number.isFinite(h)) ground = Math.max(ground, h);
      }
      if (!Number.isFinite(ground)) return null;
      return altitude - ground - Math.max(12, (altitude - (tr.elevation ?? 0)) * 0.03);
    };
    let m = margin();
    if (m === null || m >= 0) return;
    // Lifted in small steps, each less lean and a little further out, until clear: every step raises the camera
    // over the same point, so it always ends, and the view keeps what it looked at.
    busy = true;
    stats.lifted += 1;
    try {
      for (let step = 0; step < 24 && m !== null && m < 0; step++) {
        map.jumpTo({ pitch: Math.max(0, map.getPitch() - 3), zoom: map.getZoom() - 0.12 }, OWN);
        m = margin();
      }
    } finally {
      busy = false;
    }
  };

  // Once broken, the library throws from its own drawing and from every listener that reads the camera, so the
  // listeners above may never run: its errors are caught here too, and the camera repaired once they stop.
  let repairAt = 0;
  const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
    const err = 'error' in e ? e.error : (e as PromiseRejectionEvent).reason;
    const stack = err instanceof Error ? String(err.stack ?? '') : '';
    if (!/maplibre/i.test(stack)) return;
    const now = performance.now();
    if (now - repairAt < 500 || busy) return;
    repairAt = now;
    if (read() || !mayRepair()) return;
    busy = true;
    stats.restored += 1;
    try {
      repair();
    } finally {
      busy = false;
    }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  // While the camera moves only a broken camera is acted on; lifting it out of the ground waits until the move
  // ends, so a flight or an ease is never cut short.
  const onMove = () => {
    const now = performance.now();
    if (now - lastCheck < EVERY_MS || busy) return;
    lastCheck = now;
    try {
      if (read() || !mayRepair()) return;
      busy = true;
      stats.restored += 1;
      repair();
    } catch {
      // The error handler below takes it from here.
    } finally {
      busy = false;
    }
  };
  const safe = (settled: boolean) => {
    try {
      check(settled);
    } catch {
      // A camera that throws here is repaired by the error handler below.
    }
  };
  const onEnd = () => safe(true);
  // A view can also go wrong without moving, when the ground under the camera loads in taller than it was.
  const onIdle = () => safe(true);
  map.on('move', onMove);
  map.on('moveend', onEnd);
  map.on('idle', onIdle);
  return () => {
    map.off('move', onMove);
    map.off('moveend', onEnd);
    map.off('idle', onIdle);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
  };
}
