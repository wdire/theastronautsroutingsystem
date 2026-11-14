import { useApp } from './index';
import { encodeUrlState, takeInitialUrlState, type UrlState } from './url';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Applies the URL hash to the store and the map, once per page load, then keeps the hash up to date.
 * Returns a function that stops the syncing.
 */
export function startUrlSync(map: MapLibreMap): () => void {
  const initial = takeInitialUrlState(window.location.hash);
  if (initial) {
    const s = useApp.getState();
    if (initial.plan) s.setPlan({ ...s.plan, ...initial.plan });
    if (initial.departUtcMs !== undefined) s.setDepartUtcMs(initial.departUtcMs);
    if (initial.camera) {
      // A link with a view opens straight on the map, without the opening screen.
      map.jumpTo({
        center: [initial.camera.lon, initial.camera.lat],
        zoom: initial.camera.zoom,
        bearing: initial.camera.bearing,
        pitch: initial.camera.pitch,
        padding: { left: 0, right: 0, top: 0, bottom: 0 },
      });
      s.setMode('map');
      s.setLanded();
    }
    if (initial.place) s.openPlace(initial.place);
  }

  let timer = 0;
  const write = () => {
    timer = 0;
    const s = useApp.getState();
    const state: UrlState = {};
    if (s.mode === 'map' && !s.flying) state.camera = s.camera;
    state.plan = s.plan;
    if (s.departUtcMs !== null) state.departUtcMs = s.departUtcMs;
    if (s.placeId) state.place = s.placeId;
    const hash = encodeUrlState(state);
    if (hash !== window.location.hash) {
      window.history.replaceState(null, '', hash || window.location.pathname + window.location.search);
    }
  };
  const schedule = () => {
    if (!timer) timer = window.setTimeout(write, 400);
  };
  const unsubscribe = useApp.subscribe(
    (s) => [s.camera, s.plan, s.departUtcMs, s.placeId, s.mode, s.flying] as const,
    schedule,
    { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
  );
  return () => {
    unsubscribe();
    if (timer) window.clearTimeout(timer);
  };
}
