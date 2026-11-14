import { Marker, type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import type { PathPoint, RouteAlternative } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { gradesAlong, pathStats } from '@/planner/geometry';
import { useApp } from '@/store';

const SRC_ROUTE = 'route';
const SRC_ALT = 'route-alternatives';

/** Route colours: the accent on easy ground, amber above the comfortable slope, red at the limit. */
const EASY = '#9cc4ea';
const HARD = '#e9a63f';
const LIMIT = '#ee5c40';

const line = (path: readonly PathPoint[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: path.map((p) => [p[0], p[1]]) },
});

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * A line-gradient that colours the route by slope against the vehicle's limits.
 * Stops are placed by distance along the route; close stops of the same colour are merged.
 */
export function slopeGradient(path: readonly PathPoint[], comfortDeg: number, blockDeg: number): ExpressionSpecification {
  const stats = pathStats(path);
  const grades = gradesAlong(path, stats.along, 80);
  const total = Math.max(stats.distM, 1e-6);
  const colourOf = (g: number) => {
    const a = Math.abs(g);
    if (a >= comfortDeg + (blockDeg - comfortDeg) * 0.6) return LIMIT;
    if (a >= comfortDeg) return HARD;
    return EASY;
  };
  const stops: (string | number)[] = [];
  let lastT = -1;
  let lastColour = '';
  for (let i = 0; i < path.length; i += 1) {
    const t = Math.min(1, (stats.along[i] ?? 0) / total);
    const colour = colourOf(grades[i] ?? 0);
    // Stops must rise strictly, and repeating a colour adds nothing.
    if (t <= lastT + 1e-5 || (colour === lastColour && i !== path.length - 1)) continue;
    if (colour !== lastColour && lastColour && t - 0.0004 > lastT) stops.push(t - 0.0004, lastColour);
    stops.push(t, colour);
    lastT = t;
    lastColour = colour;
  }
  if (stops.length < 4) return ['interpolate', ['linear'], ['line-progress'], 0, lastColour || EASY, 1, lastColour || EASY];
  return ['interpolate', ['linear'], ['line-progress'], ...stops] as unknown as ExpressionSpecification;
}

function pinElement(label: string, kind: 'start' | 'stop'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `route-pin route-pin-${kind}`;
  el.textContent = label;
  return el;
}

/** Draws the plan on the map: pins as soon as they exist, routes when they are worked out. */
export function addRouteLayers(map: MapLibreMap): () => void {
  map.addSource(SRC_ALT, { type: 'geojson', data: EMPTY });
  map.addSource(SRC_ROUTE, { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addLayer({
    id: 'route-alt-casing',
    type: 'line',
    source: SRC_ALT,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#15120f', 'line-width': 5, 'line-opacity': 0.55 },
  });
  map.addLayer({
    id: 'route-alt',
    type: 'line',
    source: SRC_ALT,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#b9b1a6', 'line-width': 2.5, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: SRC_ROUTE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0e1a25', 'line-width': 8, 'line-opacity': 0.85 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: SRC_ROUTE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 4.5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, EASY, 1, EASY] },
  });

  let markers: Marker[] = [];
  const drawPins = () => {
    for (const m of markers) m.remove();
    markers = [];
    const { plan } = useApp.getState();
    if (plan.start) {
      markers.push(new Marker({ element: pinElement('', 'start'), anchor: 'center' }).setLngLat([plan.start.lon, plan.start.lat]).addTo(map));
    }
    plan.stops.forEach((stop, i) => {
      markers.push(new Marker({ element: pinElement(String(i + 1), 'stop'), anchor: 'center' }).setLngLat([stop.lon, stop.lat]).addTo(map));
    });
  };

  const drawRoutes = () => {
    const s = useApp.getState();
    const alt = map.getSource<GeoJSONSource>(SRC_ALT);
    const main = map.getSource<GeoJSONSource>(SRC_ROUTE);
    if (!alt || !main) return;
    if (s.route.status !== 'ready') {
      // While a new route is worked out the old one stays, dimmed, so the map does not blink.
      const stale = s.route.status === 'routing';
      map.setPaintProperty('route-line', 'line-opacity', stale ? 0.45 : 1);
      if (!stale) {
        alt.setData(EMPTY);
        main.setData(EMPTY);
      }
      return;
    }
    const chosen: RouteAlternative | undefined = s.route.alternatives.find((a) => a.id === (s.route.status === 'ready' ? s.route.selected : ''));
    const others = s.route.alternatives.filter((a) => a !== chosen);
    alt.setData({ type: 'FeatureCollection', features: others.map((a) => line(a.path)) });
    if (!chosen || chosen.path.length < 2) {
      main.setData(EMPTY);
      return;
    }
    const vehicle = VEHICLES[s.plan.vehicle];
    main.setData(line(chosen.path));
    map.setPaintProperty('route-line', 'line-gradient', slopeGradient(chosen.path, vehicle.comfortSlopeDeg, vehicle.blockSlopeDeg));
    map.setPaintProperty('route-line', 'line-opacity', 1);
  };

  drawPins();
  drawRoutes();
  const offPlan = useApp.subscribe((s) => s.plan, drawPins);
  const offRoute = useApp.subscribe((s) => s.route, drawRoutes);

  return () => {
    offPlan();
    offRoute();
    for (const m of markers) m.remove();
    for (const id of ['route-line', 'route-casing', 'route-alt', 'route-alt-casing']) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_ROUTE, SRC_ALT]) if (map.getSource(id)) map.removeSource(id);
  };
}
