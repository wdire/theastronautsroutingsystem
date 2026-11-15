/**
 * Direction marks on route lines: a small chevron in the middle of each leg (and more along a long one), laid
 * flat on the map so it points the way the route goes, tilted or not. Out-and-back legs drawn side by side
 * read at a glance this way.
 */
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { PathPoint } from '@/engines/types';
import { bearingDeg } from '@/lib/geo';
import { pathStats, pointAlong } from '@/planner/geometry';

const IMAGE = 'route-chevron';
/** One chevron per this much leg, at least one per leg, m. */
const EVERY_M = 900;
/** The direction is read over this much route either side of a chevron, so one kink does not twist it, m. */
const SPAN_M = 25;

type Point = { type: 'Feature'; properties: { bearing: number }; geometry: { type: 'Point'; coordinates: [number, number] } };
export const NO_ARROWS = { type: 'FeatureCollection' as const, features: [] as Point[] };

/** A chevron pointing north, light on a dark rim, drawn at twice the size it shows. */
function ensureImage(map: MapLibreMap): void {
  if (map.hasImage(IMAGE)) return;
  const px = 2;
  const size = 20 * px;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (width: number, colour: string) => {
    ctx.beginPath();
    ctx.moveTo(size * 0.27, size * 0.66);
    ctx.lineTo(size * 0.5, size * 0.36);
    ctx.lineTo(size * 0.73, size * 0.66);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.stroke();
  };
  stroke(6.5 * px, 'rgba(14, 26, 37, 0.9)');
  stroke(2.6 * px, '#f4f8fc');
  map.addImage(IMAGE, ctx.getImageData(0, 0, size, size), { pixelRatio: px });
}

/** Where along a path the chevrons go, and which way each points. `stopIndices` split the path into legs. */
export function arrowPoints(path: readonly PathPoint[], stopIndices: readonly number[]): Point[] {
  if (path.length < 2) return [];
  const { along } = pathStats(path);
  const at = (d: number): [number, number] => {
    const p = pointAlong(path, along, d);
    return [p[0], p[1]];
  };
  const bounds = stopIndices.length >= 2 ? [...stopIndices] : [0, path.length - 1];
  const out: Point[] = [];
  for (let k = 1; k < bounds.length; k += 1) {
    const from = along[Math.max(0, Math.min(along.length - 1, bounds[k - 1]!))]!;
    const to = along[Math.max(0, Math.min(along.length - 1, bounds[k]!))]!;
    const len = to - from;
    // Too short to need one: the pins at either end say it all.
    if (len < 40) continue;
    const n = Math.max(1, Math.floor(len / EVERY_M));
    for (let i = 0; i < n; i += 1) {
      const d = from + (len * (i + 0.5)) / n;
      const p = at(d);
      const back = at(Math.max(from, d - SPAN_M));
      const ahead = at(Math.min(to, d + SPAN_M));
      out.push({ type: 'Feature', properties: { bearing: bearingDeg(back[0], back[1], ahead[0], ahead[1]) }, geometry: { type: 'Point', coordinates: p } });
    }
  }
  return out;
}

/** A source and a symbol layer of chevrons. Returns a setter for the path and a remover. */
export function addArrowLayer(map: MapLibreMap, id: string, beforeId?: string) {
  ensureImage(map);
  map.addSource(id, { type: 'geojson', data: NO_ARROWS });
  map.addLayer(
    {
      id,
      type: 'symbol',
      source: id,
      // Zoomed out a route is a few pixels across; its chevrons would only clutter it.
      minzoom: 11,
      layout: {
        'icon-image': IMAGE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        // Out-and-back legs put two chevrons side by side, pointing opposite ways: both stay. They never push a
        // place name off the map.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.75, 14, 1, 17, 1.15],
      },
    },
    beforeId && map.getLayer(beforeId) ? beforeId : undefined,
  );
  return {
    set(path: readonly PathPoint[] | null, stopIndices: readonly number[] = []): void {
      map.getSource<GeoJSONSource>(id)?.setData(path ? { type: 'FeatureCollection', features: arrowPoints(path, stopIndices) } : NO_ARROWS);
    },
    setOpacity(o: number): void {
      if (map.getLayer(id)) map.setPaintProperty(id, 'icon-opacity', o);
    },
    remove(): void {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    },
  };
}
