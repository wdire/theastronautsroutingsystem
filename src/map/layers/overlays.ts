import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { getCoverage, hasTile, loadCoverage, tileUrl, type Product } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { loadGeology, loadTraverse } from '@/data/datasets';
import { TILE } from '@/data/terrarium';
import { VEHICLES } from '@/engines/vehicles';
import { metresPerPixel, pxToLat } from '@/lib/geo';
import { useApp, type Overlay } from '@/store';
import { setTileHandler, type TileData } from '../protocol';

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

function transparentTile(): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(TILE, TILE));
}

/** Overlay tiles straight from the package; transparent where the package has none. */
async function overlayTile(rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const product = rest[0] as Product | undefined;
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov || !product || !hasTile(cov, product, z, x, y)) return transparentTile();
  const res = await fetch(tileUrl(cov, { product, z, x, y }), { signal });
  return res.ok ? res.arrayBuffer() : transparentTile();
}

/** Slope against the chosen vehicle's limits: clear where it is easy, amber where it is hard, red where it cannot go. */
async function slopeTile(_rest: string[], z: number, x: number, y: number): Promise<TileData> {
  const { heights } = await tileHeights(z, x, y);
  const v = VEHICLES[useApp.getState().plan.vehicle];
  const cell = metresPerPixel(pxToLat((y + 0.5) * TILE, z), z);
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  const at = (ix: number, iy: number) => heights[Math.max(0, Math.min(TILE - 1, iy)) * TILE + Math.max(0, Math.min(TILE - 1, ix))] ?? 0;
  for (let iy = 0; iy < TILE; iy += 1) {
    for (let ix = 0; ix < TILE; ix += 1) {
      const dzdx = (at(ix + 1, iy) - at(ix - 1, iy)) / (2 * cell);
      const dzdy = (at(ix, iy + 1) - at(ix, iy - 1)) / (2 * cell);
      const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const o = (iy * TILE + ix) * 4;
      if (slope >= v.blockSlopeDeg) {
        rgba.set([226, 62, 44, 190], o);
      } else if (slope >= v.comfortSlopeDeg) {
        const t = (slope - v.comfortSlopeDeg) / Math.max(1, v.blockSlopeDeg - v.comfortSlopeDeg);
        rgba.set([233, 166 - 60 * t, 63 - 10 * t, 120 + 60 * t], o);
      } else if (slope >= v.comfortSlopeDeg * 0.6) {
        const t = (slope - v.comfortSlopeDeg * 0.6) / (v.comfortSlopeDeg * 0.4);
        rgba.set([233, 190, 90, 70 * t], o);
      }
    }
  }
  return createImageBitmap(new ImageData(rgba, TILE, TILE));
}

setTileHandler('overlay', overlayTile);
setTileHandler('derived', slopeTile);

const RASTER: Record<Exclude<Overlay, 'none' | 'geology'>, { tiles: string; maxzoom: number; minzoom: number; opacity: number }> = {
  olivine: { tiles: 'mars://overlay/crism/{z}/{x}/{y}', minzoom: 9, maxzoom: 12, opacity: 0.85 },
  carbonate: { tiles: 'mars://overlay/crismCarbonate/{z}/{x}/{y}', minzoom: 9, maxzoom: 12, opacity: 0.85 },
  slope: { tiles: 'mars://derived/slope/{z}/{x}/{y}', minzoom: 6, maxzoom: 12, opacity: 1 },
};

/** Overlays chosen in the Layers panel, the geologic map among them, and Perseverance's drive. */
export function addOverlays(map: MapLibreMap): () => void {
  const before = map.getLayer('route-alt-casing') ? 'route-alt-casing' : undefined;
  map.addSource('geology', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'geology-fill', type: 'fill', source: 'geology', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.42 } }, before);
  map.addLayer({ id: 'geology-line', type: 'line', source: 'geology', layout: { visibility: 'none' }, paint: { 'line-color': '#1b1512', 'line-width': 1, 'line-opacity': 0.6 } }, before);
  void loadGeology()
    .then((geo) => {
      const colour = new Map(geo.units.map((u) => [u.code, u.colour]));
      const data = {
        type: 'FeatureCollection' as const,
        features: geo.features.features.map((f) => ({ ...f, properties: { ...f.properties, colour: colour.get(f.properties.unit) ?? '#888888' } })),
      };
      map.getSource<GeoJSONSource>('geology')?.setData(data as unknown as Parameters<GeoJSONSource['setData']>[0]);
    })
    .catch(() => undefined);

  map.addSource('traverse', { type: 'geojson', data: EMPTY });
  map.addSource('traverse-stops', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'traverse-casing', type: 'line', source: 'traverse', minzoom: 9, layout: { 'line-join': 'round' }, paint: { 'line-color': '#1b1512', 'line-width': 3.5, 'line-opacity': 0.7 } }, before);
  map.addLayer({ id: 'traverse-line', type: 'line', source: 'traverse', minzoom: 9, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fbf4ea', 'line-width': 1.6 } }, before);
  map.addLayer(
    { id: 'traverse-stops', type: 'circle', source: 'traverse-stops', minzoom: 12, paint: { 'circle-radius': 2.4, 'circle-color': '#fbf4ea', 'circle-stroke-color': '#1b1512', 'circle-stroke-width': 1 } },
    before,
  );
  void loadTraverse()
    .then((t) => {
      map.getSource<GeoJSONSource>('traverse')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.path.map((p) => [p[0], p[1]]) } });
      map.getSource<GeoJSONSource>('traverse-stops')?.setData({
        type: 'FeatureCollection',
        features: t.waypoints.map((w) => ({ type: 'Feature' as const, properties: { sol: w.sol }, geometry: { type: 'Point' as const, coordinates: [w.lon, w.lat] } })),
      });
    })
    .catch(() => undefined);

  let shown: Overlay = 'none';
  let shownVehicle = '';
  const apply = () => {
    const s = useApp.getState();
    const { overlay, traverse } = s.layers;
    for (const id of ['traverse-casing', 'traverse-line', 'traverse-stops']) map.setLayoutProperty(id, 'visibility', traverse ? 'visible' : 'none');
    for (const id of ['geology-fill', 'geology-line']) map.setLayoutProperty(id, 'visibility', overlay === 'geology' ? 'visible' : 'none');
    // The slope overlay depends on the vehicle, so a change of vehicle redraws it.
    const key = overlay === 'slope' ? s.plan.vehicle : '';
    if (overlay === shown && key === shownVehicle) return;
    shown = overlay;
    shownVehicle = key;
    if (map.getLayer('overlay-raster')) map.removeLayer('overlay-raster');
    if (map.getSource('overlay-raster')) map.removeSource('overlay-raster');
    if (overlay === 'none' || overlay === 'geology') return;
    const def = RASTER[overlay];
    map.addSource('overlay-raster', { type: 'raster', tiles: [`${def.tiles}?${key}`], tileSize: 256, minzoom: def.minzoom, maxzoom: def.maxzoom });
    map.addLayer({ id: 'overlay-raster', type: 'raster', source: 'overlay-raster', paint: { 'raster-opacity': def.opacity, 'raster-fade-duration': 150 } }, 'geology-fill');
  };
  apply();
  const offLayers = useApp.subscribe((s) => s.layers, apply);
  const offVehicle = useApp.subscribe((s) => s.plan.vehicle, apply);
  return () => {
    offLayers();
    offVehicle();
  };
}
