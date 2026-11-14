import { Marker, type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from 'maplibre-gl';
import type { PathPoint, RouteAlternative } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { gradesAlong, pathStats } from '@/planner/geometry';
import { useApp } from '@/store';
import { startsAtBase } from '@/planner/base';

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
 * A line-gradient that colours the route by slope against the vehicle’s limits.
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
  /** A pin the visitor can drag: letting go moves the start or the stop there and the route follows. */
  const pin = (label: string, kind: 'start' | 'stop', lon: number, lat: number, moved: (lon: number, lat: number) => void): Marker => {
    const marker = new Marker({ element: pinElement(label, kind), anchor: 'center', draggable: true }).setLngLat([lon, lat]).addTo(map);
    marker.on('dragend', () => {
      const at = marker.getLngLat();
      moved(at.lng, at.lat);
    });
    return marker;
  };
  const drawPins = () => {
    for (const m of markers) m.remove();
    markers = [];
    const { plan } = useApp.getState();
    // The visitor's own base has its own marker; a plan shared by another commander starts at theirs.
    if (plan.start && !startsAtBase(plan, useApp.getState().base)) {
      const m = new Marker({ element: pinElement('', 'start'), anchor: 'center' }).setLngLat([plan.start.lon, plan.start.lat]).addTo(map);
      markers.push(m);
    }
    plan.stops.forEach((stop, i) => {
      markers.push(pin(String(i + 1), 'stop', stop.lon, stop.lat, (lon, lat) => useApp.getState().updateStop(stop.id, { lon, lat, name: undefined, placeId: undefined })));
    });
  };

  // A click on the route adds a stop there, between the stops it lies between: work along the way needs no detour.
  const onRouteClick = (e: MapLayerMouseEvent) => {
    const s = useApp.getState();
    if (s.route.status !== 'ready' || s.picking || s.flyover) return;
    const chosen = s.route.alternatives.find((a) => a.id === (s.route.status === 'ready' ? s.route.selected : ''));
    if (!chosen) return;
    // The route's own point nearest the click, so the stop sits on the route and not beside it.
    let nearest = 0;
    let best = Infinity;
    chosen.path.forEach((p, i) => {
      const d = (p[0] - e.lngLat.lng) ** 2 * Math.cos((p[1] * Math.PI) / 180) ** 2 + (p[1] - e.lngLat.lat) ** 2;
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    const at = chosen.path[nearest];
    if (!at) return;
    // The leg is the one whose end is the first waypoint past the click; the new stop goes in before that waypoint.
    const leg = Math.max(0, chosen.stopIndices.findIndex((index, i) => i > 0 && index >= nearest) - 1);
    e.preventDefault();
    s.addStop({ lon: at[0], lat: at[1] }, Math.min(leg, s.plan.stops.length));
    s.openPlanner(true);
  };
  const pointer = () => {
    map.getCanvas().style.cursor = 'copy';
  };
  const noPointer = () => {
    map.getCanvas().style.cursor = '';
  };
  map.on('click', 'route-line', onRouteClick);
  map.on('mouseenter', 'route-line', pointer);
  map.on('mouseleave', 'route-line', noPointer);

  // The places on the route a crew must know: where turning back stops being possible, where the air ends.
  let marks: Marker[] = [];
  const clearMarks = () => {
    for (const m of marks) m.remove();
    marks = [];
  };
  const drawMarks = (route: RouteAlternative) => {
    clearMarks();
    // While a mission runs the plan's lines are hidden; marks left behind would sit on a route nobody is on.
    if (useApp.getState().world?.run) return;
    const add = (index: number | null, kind: 'no-return' | 'o2-out' | 'walkback', text: string) => {
      const p = index === null ? undefined : route.path[index];
      if (!p) return;
      const el = document.createElement('div');
      el.className = `route-mark route-mark-${kind}`;
      const ring = document.createElement('span');
      ring.className = 'route-mark-ring';
      const label = document.createElement('span');
      label.className = 'map-label ring-label';
      label.textContent = text;
      el.append(ring, label);
      marks.push(new Marker({ element: el, anchor: 'left', offset: [-7, 0] }).setLngLat([p[0], p[1]]).addTo(map));
    };
    add(route.trip.pointOfNoReturnIndex, 'no-return', 'Point of no return');
    add(route.trip.walkbackIndex, 'walkback', 'Walk-home limit');
    add(route.trip.o2OutIndex, 'o2-out', 'Oxygen runs out');
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
        clearMarks();
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
    drawMarks(chosen);
    map.setPaintProperty('route-line', 'line-gradient', slopeGradient(chosen.path, vehicle.comfortSlopeDeg, vehicle.blockSlopeDeg));
    map.setPaintProperty('route-line', 'line-opacity', 1);
  };

  drawPins();
  drawRoutes();
  const offPlan = useApp.subscribe((s) => s.plan, drawPins);
  const offRoute = useApp.subscribe((s) => s.route, drawRoutes);
  const offRun = useApp.subscribe((s) => s.world?.run != null, drawRoutes);

  return () => {
    offPlan();
    offRoute();
    offRun();
    map.off('click', 'route-line', onRouteClick);
    map.off('mouseenter', 'route-line', pointer);
    map.off('mouseleave', 'route-line', noPointer);
    for (const m of markers) m.remove();
    clearMarks();
    for (const id of ['route-line', 'route-casing', 'route-alt', 'route-alt-casing']) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_ROUTE, SRC_ALT]) if (map.getSource(id)) map.removeSource(id);
  };
}
