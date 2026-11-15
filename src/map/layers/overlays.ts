import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { getCoverage, hasTile, loadCoverage, tileUrl, type Product } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { loadGeology, loadTraverse } from '@/data/datasets';
import { TILE } from '@/data/terrarium';
import { VEHICLES } from '@/engines/vehicles';
import { metresPerPixel, pxToLat } from '@/lib/geo';
import { useApp, type Overlay } from '@/store';
import { setTileHandler, type TileData } from '../protocol';
import { MOLA_COLOUR, THEMIS_NIGHT, warpToTile, type EquirectSource } from '../protocol/live';

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

/** Slope against the chosen vehicle’s limits: clear where it is easy, amber where it is hard, red where it cannot go. */
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

/**
 * The night-time warmth of the ground as a colour ramp: deep indigo where it cools fast (dust and fine sand,
 * soft going for wheels), through rust, to pale gold where it holds the day's heat (rock and bedrock).
 */
const NIGHT_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 28, 24, 64],
  [0.35, 92, 40, 92],
  [0.6, 196, 84, 58],
  [0.82, 236, 170, 88],
  [1, 252, 238, 186],
];

function nightColour(v: number): [number, number, number] {
  for (let i = 1; i < NIGHT_RAMP.length; i += 1) {
    const b = NIGHT_RAMP[i]!;
    const a = NIGHT_RAMP[i - 1]!;
    if (v <= b[0]) {
      const t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const last = NIGHT_RAMP[NIGHT_RAMP.length - 1]!;
  return [last[1], last[2], last[3]];
}

const LIVE: Record<string, EquirectSource> = { night: THEMIS_NIGHT, elevation: MOLA_COLOUR };

/**
 * Overlays read live from NASA Mars Trek and warped to the map's tiles: THEMIS night infrared (as a colour
 * ramp, stretched within each tile so local differences show) and MOLA elevation in colour.
 */
async function liveTile(rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const src = LIVE[rest[0] ?? ''];
  if (!src) return transparentTile();
  const warped = await warpToTile(src, z, x, y, 0, 20_000, signal);
  if (!warped) return transparentTile();
  const px = warped.rgba;
  if (src === THEMIS_NIGHT) {
    // A local stretch: the mosaic's own brightness changes from image to image, so only contrast within the
    // tile is read, from the 2nd to the 98th percentile.
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if ((px[i + 3] ?? 0) < 128) continue;
      hist[px[i] ?? 0] = (hist[px[i] ?? 0] ?? 0) + 1;
      n += 1;
    }
    let lo = 0;
    let hi = 255;
    for (let acc = 0, v = 0; v < 256; v += 1) {
      acc += hist[v] ?? 0;
      if (acc >= n * 0.02) {
        lo = v;
        break;
      }
    }
    for (let acc = 0, v = 255; v >= 0; v -= 1) {
      acc += hist[v] ?? 0;
      if (acc >= n * 0.02) {
        hi = v;
        break;
      }
    }
    const span = Math.max(24, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = nightColour(Math.max(0, Math.min(1, ((px[i] ?? 0) - lo) / span)));
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = (px[i + 3] ?? 0) > 8 ? 235 : 0;
    }
  }
  return createImageBitmap(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, warped.size, warped.size));
}

setTileHandler('overlay', overlayTile);
setTileHandler('derived', slopeTile);
setTileHandler('live', liveTile);

/** One overlay tile for a canvas of its own (Rover View's tablet), as the map would draw it. */
export function overlayTileFor(overlay: Exclude<Overlay, 'none' | 'geology'>, z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const def = RASTER[overlay];
  const kind = /^mars:\/\/([a-z]+)\/([A-Za-z]+)\//.exec(def.tiles);
  const rest = [kind?.[2] ?? ''];
  if (kind?.[1] === 'live') return liveTile(rest, z, x, y, signal);
  if (kind?.[1] === 'derived') return slopeTile(rest, z, x, y);
  return overlayTile(rest, z, x, y, signal);
}

export const RASTER: Record<Exclude<Overlay, 'none' | 'geology'>, { tiles: string; maxzoom: number; minzoom: number; opacity: number }> = {
  olivine: { tiles: 'mars://overlay/crism/{z}/{x}/{y}', minzoom: 9, maxzoom: 12, opacity: 0.85 },
  carbonate: { tiles: 'mars://overlay/crismCarbonate/{z}/{x}/{y}', minzoom: 9, maxzoom: 12, opacity: 0.85 },
  slope: { tiles: 'mars://derived/slope/{z}/{x}/{y}', minzoom: 6, maxzoom: 12, opacity: 1 },
  night: { tiles: 'mars://live/night/{z}/{x}/{y}', minzoom: 3, maxzoom: 10, opacity: 0.78 },
  elevation: { tiles: 'mars://live/elevation/{z}/{x}/{y}', minzoom: 0, maxzoom: 8, opacity: 0.72 },
};

/** Overlays chosen in the Layers panel, the geologic map among them, and Perseverance’s drive. */
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
  map.addLayer({ id: 'traverse-casing', type: 'line', source: 'traverse', minzoom: 9, layout: { 'line-join': 'round' }, paint: { 'line-color': '#1b1512', 'line-width': 3, 'line-opacity': 0.45 } }, before);
  map.addLayer({ id: 'traverse-line', type: 'line', source: 'traverse', minzoom: 9, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fbf4ea', 'line-width': 1.4, 'line-opacity': 0.8 } }, before);
  map.addLayer(
    { id: 'traverse-stops', type: 'circle', source: 'traverse-stops', minzoom: 13.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.5, 1.6, 16, 3], 'circle-color': '#fbf4ea', 'circle-stroke-color': '#1b1512', 'circle-stroke-width': 1 } },
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
