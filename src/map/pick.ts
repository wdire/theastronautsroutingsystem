import type { Map as MapLibreMap, Marker as MarkerType } from 'maplibre-gl';
import { Marker } from 'maplibre-gl';
import { loadPlaces, loadSamples } from '@/data/datasets';
import { resolvePlace } from '@/data/places';
import { useApp } from '@/store';

interface Target {
  key: string;
  lon: number;
  lat: number;
}

let targets: Target[] = [];
let targetsLoaded = false;

async function loadTargets(): Promise<void> {
  if (targetsLoaded) return;
  targetsLoaded = true;
  const [places, samples] = await Promise.all([loadPlaces().catch(() => []), loadSamples().catch(() => [])]);
  targets = [
    ...places.filter((p) => p.kind !== 'sample').map((p) => ({ key: `place:${p.id}`, lon: p.lon, lat: p.lat })),
    ...samples.map((s) => ({ key: `sample:${s.id}`, lon: s.lon, lat: s.lat })),
  ];
}

/** The key of what a click means: a known place within reach of the pointer, else the point itself. */
export function pickKey(map: MapLibreMap, point: { x: number; y: number }, lngLat: { lng: number; lat: number }): string {
  let best: Target | null = null;
  let bestD = 18 * 18;
  if (map.getZoom() >= 11) {
    for (const t of targets) {
      const p = map.project([t.lon, t.lat]);
      const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
  }
  return best ? best.key : `@${lngLat.lat.toFixed(5)},${lngLat.lng.toFixed(5)}`;
}

/** Opens a place card on a map click, and keeps a pin on the place whose card is open. */
export function addPlacePicking(map: MapLibreMap): () => void {
  void loadTargets();
  const onClick = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number }; defaultPrevented?: boolean }) => {
    const s = useApp.getState();
    if (s.mode !== 'map' || s.flying || e.defaultPrevented) return;
    const key = pickKey(map, e.point, e.lngLat);
    if (s.picking) {
      // The planner asked for a point: the click sets the start or adds a stop, named if it hit a known place.
      const target = s.picking;
      if (target === 'roverView') {
        s.openVisor({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }
      s.setPicking(null);
      void resolvePlace(key).then((view) => {
        const at = view && view.kind !== 'point' ? { lon: view.lon, lat: view.lat, name: view.name, placeId: view.key } : { lon: e.lngLat.lng, lat: e.lngLat.lat };
        const app = useApp.getState();
        if (target === 'start') app.setStart(at);
        else app.addStop(at);
      });
      return;
    }
    s.openPlace(key);
  };
  map.on('click', onClick);

  const el = document.createElement('div');
  el.className = 'place-pin';
  el.setAttribute('aria-hidden', 'true');
  let marker: MarkerType | null = null;
  let token = 0;
  const sync = (placeId: string | null) => {
    token += 1;
    const mine = token;
    if (!placeId) {
      marker?.remove();
      marker = null;
      return;
    }
    void resolvePlace(placeId).then((view) => {
      if (mine !== token) return;
      if (!view) {
        marker?.remove();
        marker = null;
        return;
      }
      marker ??= new Marker({ element: el, anchor: 'bottom' });
      marker.setLngLat([view.lon, view.lat]).addTo(map);
    });
  };
  sync(useApp.getState().placeId);
  const unsubscribe = useApp.subscribe((s) => s.placeId, sync);
  const offPicking = useApp.subscribe(
    (s) => s.picking,
    (picking) => map.getCanvas().classList.toggle('is-picking', picking !== null),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && useApp.getState().picking) useApp.getState().setPicking(null);
  };
  window.addEventListener('keydown', onKey);

  return () => {
    map.off('click', onClick);
    unsubscribe();
    offPicking();
    window.removeEventListener('keydown', onKey);
    marker?.remove();
  };
}
