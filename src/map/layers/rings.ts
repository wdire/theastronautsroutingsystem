import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { loadGrid } from '@/data/dem';
import { SUIT_FLAT_KMH } from '@/engines/isochrone';
import type { LonLat, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { MARS_RADIUS_M, REGION, inBox } from '@/lib/constants';
import { useApp } from '@/store';
import type { RingsReply, RingsRequest } from '../rings.worker';

const SRC = 'range-rings';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const ON_FOOT_HOURS = [1, 2, 4];
const RING_CELLS = 170_000;

/** How long a crew could walk home on suit air, if the budget engine is in this build. */
const tripModules = import.meta.glob<{ walkbackLimitHours?: (vehicle: VehicleId) => number }>('../../engines/tripComputer.ts');

async function walkHomeHours(vehicle: VehicleId): Promise<number | null> {
  const load = Object.values(tripModules)[0];
  if (!load) return null;
  try {
    const hours = (await load()).walkbackLimitHours?.(vehicle);
    return typeof hours === 'number' && hours > 0 && Number.isFinite(hours) ? hours : null;
  } catch {
    return null;
  }
}

/** Which rings a vehicle gets: fixed walking times on foot, the walk-home limit for a crewed rover. */
async function ringsFor(vehicle: VehicleId): Promise<{ hours: number[]; label: (h: number) => string } | null> {
  const v = VEHICLES[vehicle];
  if (v.kind === 'walk') return { hours: ON_FOOT_HOURS, label: (h) => `${h} h on foot` };
  if (v.crew > 0 && v.kind !== 'air') {
    const hours = await walkHomeHours(vehicle);
    return hours ? { hours: [hours], label: () => 'Walk-home limit' } : null;
  }
  return null;
}

/**
 * Walking range from the mission's start, drawn over the real ground: steep slopes pull a ring in,
 * flat floors let it run. On foot the rings are 1, 2 and 4 hours; for a crewed rover there is one,
 * the furthest the crew could walk back from if the rover failed.
 */
export function addRangeRings(map: MapLibreMap): () => void {
  map.addSource(SRC, { type: 'geojson', data: EMPTY });
  const before = map.getLayer('route-alt-casing') ? 'route-alt-casing' : undefined;
  map.addLayer({ id: 'range-rings-casing', type: 'line', source: SRC, paint: { 'line-color': '#1b1512', 'line-width': 3, 'line-opacity': 0.4 } }, before);
  map.addLayer({ id: 'range-rings', type: 'line', source: SRC, paint: { 'line-color': '#fbf4ea', 'line-width': 1.2, 'line-opacity': 0.85, 'line-dasharray': [3, 2.5] } }, before);

  const worker = new Worker(new URL('../rings.worker.ts', import.meta.url), { type: 'module' });
  let run = 0;
  let labels: Marker[] = [];
  let labelFor: (h: number) => string = String;

  const clear = () => {
    map.getSource<GeoJSONSource>(SRC)?.setData(EMPTY);
    for (const m of labels) m.remove();
    labels = [];
  };

  worker.onmessage = (e: MessageEvent<RingsReply>) => {
    if (e.data.id !== run) return;
    clear();
    const features = [];
    for (const ring of e.data.rings) {
      // The longest line is the ring itself; shorter ones are holes around ground too steep to reach.
      const lines = ring.lines.filter((l) => l.length > 8).sort((a, b) => b.length - a.length);
      for (const coordinates of lines) features.push({ type: 'Feature' as const, properties: { hours: ring.hours }, geometry: { type: 'LineString' as const, coordinates: coordinates as LonLat[] } });
      const outer = lines[0];
      if (!outer) continue;
      // Labelled on the east side, where a map reader looks for the end of a scale.
      let east = outer[0];
      for (const p of outer) if (east && p[0] > east[0]) east = p;
      if (!east) continue;
      const el = document.createElement('div');
      el.className = 'map-label ring-label';
      el.textContent = labelFor(ring.hours);
      labels.push(new Marker({ element: el, anchor: 'left', offset: [5, 0] }).setLngLat([east[0], east[1]]).addTo(map));
    }
    map.getSource<GeoJSONSource>(SRC)?.setData({ type: 'FeatureCollection', features });
  };

  const update = () => {
    const s = useApp.getState();
    const id = (run += 1);
    const start = s.plan.start;
    if (!s.layers.rings || !start || !inBox(REGION, start.lon, start.lat)) return clear();
    void ringsFor(s.plan.vehicle).then(async (spec) => {
      if (id !== run) return;
      if (!spec) return clear();
      labelFor = spec.label;
      // A box that holds the furthest ring on flat ground, with a margin for the contour to close.
      const reachM = Math.max(...spec.hours) * SUIT_FLAT_KMH * 1000 * 1.08;
      const dLat = (reachM / MARS_RADIUS_M) * (180 / Math.PI);
      const dLon = dLat / Math.cos((start.lat * Math.PI) / 180);
      try {
        const grid = await loadGrid([start.lon - dLon, start.lat - dLat, start.lon + dLon, start.lat + dLat], RING_CELLS);
        if (id !== run) return;
        const request: RingsRequest = { id, grid: grid.spec, lat: start.lat, lon: start.lon, hours: spec.hours };
        worker.postMessage(request);
      } catch {
        clear();
      }
    });
  };

  update();
  const off = useApp.subscribe((s) => `${s.plan.start?.lon},${s.plan.start?.lat}|${s.plan.vehicle}|${s.layers.rings}`, update);
  return () => {
    off();
    run += 1;
    worker.terminate();
    clear();
    for (const id of ['range-rings', 'range-rings-casing']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
