import { Marker, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { HazardZone, PathPoint } from '@/engines/types';
import { destination } from '@/lib/geo';
import { clockTicking } from '@/sim/controller';
import { createSmoothTime } from '@/sim/smoothTime';
import { addArrowLayer } from './arrows';
import { crewAt } from '@/sim/world';
import { useApp } from '@/store';

const SRC_PATH = 'mission-path';
const SRC_PROPOSED = 'mission-proposed';
const SRC_HAZARD = 'mission-hazards';
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

const line = (path: readonly PathPoint[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: path.map((p) => [p[0], p[1]]) } });

/** A hazard zone as a ring of points: the map has no circle in metres. */
function disc(h: HazardZone) {
  const ring: [number, number][] = [];
  for (let a = 0; a <= 360; a += 10) ring.push(destination(h.lon, h.lat, a, h.radiusM));
  return { type: 'Feature' as const, properties: { kind: h.kind }, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
}

/**
 * A running mission on the map: the route being followed, the crew moving along it, the hazards in
 * play, and a proposed new route as a dashed line until it is taken or dropped.
 */
export function addMissionLayers(map: MapLibreMap): () => void {
  for (const id of [SRC_PATH, SRC_PROPOSED, SRC_HAZARD]) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'mission-hazard-fill', type: 'fill', source: SRC_HAZARD, paint: { 'fill-color': '#ee5c40', 'fill-opacity': 0.22 } });
  map.addLayer({ id: 'mission-hazard-line', type: 'line', source: SRC_HAZARD, paint: { 'line-color': '#ee5c40', 'line-width': 1.8, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'mission-path-casing', type: 'line', source: SRC_PATH, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0e1a25', 'line-width': 7, 'line-opacity': 0.75 } });
  map.addLayer({ id: 'mission-path', type: 'line', source: SRC_PATH, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9cc4ea', 'line-width': 4 } });
  const arrows = addArrowLayer(map, 'mission-arrows');
  const proposedArrows = addArrowLayer(map, 'mission-proposed-arrows');
  map.addLayer({ id: 'mission-proposed-casing', type: 'line', source: SRC_PROPOSED, paint: { 'line-color': '#0e1a25', 'line-width': 6, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'mission-proposed', type: 'line', source: SRC_PROPOSED, paint: { 'line-color': '#8dbf8f', 'line-width': 3.2, 'line-dasharray': [2, 1.3] } });

  const el = document.createElement('div');
  el.className = 'crew-marker';
  el.innerHTML = '<span class="crew-marker-arrow"></span>';
  const crew = new Marker({ element: el, anchor: 'center', rotationAlignment: 'map' });
  let shown = false;

  let lastRun = '';
  let lastHazards = '';
  let lastProposed: unknown = null;
  const draw = () => {
    const s = useApp.getState();
    const run = s.world?.run ?? null;
    // The route line is redrawn only when the route changes, not ten times a second.
    const runKey = run ? `${run.id}:${run.leg}` : '';
    if (runKey !== lastRun) {
      lastRun = runKey;
      map.getSource<GeoJSONSource>(SRC_PATH)?.setData(run ? line(run.path) : EMPTY);
      arrows.set(run ? run.path : null, run?.stopIndices ?? []);
      // The plan's own lines step back while a mission runs: after a reroute they would show a route nobody is on.
      for (const id of ['route-line', 'route-casing', 'route-alt', 'route-alt-casing', 'route-arrows']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', run ? 'none' : 'visible');
    }
    const hazards = s.world?.hazards ?? [];
    const hazardKey = hazards.map((h) => h.id).join('|');
    if (hazardKey !== lastHazards) {
      lastHazards = hazardKey;
      map.getSource<GeoJSONSource>(SRC_HAZARD)?.setData({ type: 'FeatureCollection', features: hazards.map(disc) });
    }
    if (s.proposed !== lastProposed) {
      lastProposed = s.proposed;
      map.getSource<GeoJSONSource>(SRC_PROPOSED)?.setData(s.proposed ? line(s.proposed.path) : EMPTY);
      proposedArrows.set(s.proposed ? s.proposed.path : null, s.proposed?.stopIndices ?? []);
    }
    if (run && s.world) {
      // The frame loop places it while the clock runs; a tick only needs to when the loop is not running.
      if (!frame) placeCrew();
      if (!shown) {
        crew.addTo(map);
        shown = true;
      }
      // While the clock moves, the marker is placed every frame, between the simulation's ticks.
      if (!frame && clockTicking(s.world)) frame = requestAnimationFrame(animate);
    } else if (shown) {
      crew.remove();
      shown = false;
      lastLon = Number.POSITIVE_INFINITY;
    }
  };

  const frameUtc = createSmoothTime();
  let frame = 0;
  let lastLon = Number.POSITIVE_INFINITY;
  let lastLat = Number.POSITIVE_INFINITY;
  let lastHeading = Number.POSITIVE_INFINITY;
  const placeCrew = (): boolean => {
    const w = useApp.getState().world;
    if (!w?.run) return false;
    const at = crewAt(w.run, frameUtc(w));
    // At 1x the crew moves a few centimetres a frame: the marker is touched only when that shows.
    if (Math.abs(at.lon - lastLon) > 2e-7 || Math.abs(at.lat - lastLat) > 2e-7 || Math.abs(at.headingDeg - lastHeading) > 0.5) {
      lastLon = at.lon;
      lastLat = at.lat;
      lastHeading = at.headingDeg;
      crew.setLngLat([at.lon, at.lat]).setRotation(at.headingDeg);
    }
    return clockTicking(w);
  };
  const animate = () => {
    frame = 0;
    if (placeCrew() && shown) frame = requestAnimationFrame(animate);
  };

  draw();
  const off = useApp.subscribe((s) => [s.world, s.proposed] as const, draw, { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] });
  return () => {
    off();
    cancelAnimationFrame(frame);
    arrows.remove();
    proposedArrows.remove();
    crew.remove();
    for (const id of ['mission-proposed', 'mission-proposed-casing', 'mission-path', 'mission-path-casing', 'mission-hazard-line', 'mission-hazard-fill']) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_PATH, SRC_PROPOSED, SRC_HAZARD]) if (map.getSource(id)) map.removeSource(id);
  };
}
