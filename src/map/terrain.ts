import type { Map as MapLibreMap } from 'maplibre-gl';
import { reliefExaggeration } from '@/engines/relief';
import { mapLighting } from '@/engines/lighting';
import { sunPosition } from '@/engines/marsTime';
import { useApp } from '@/store';
import { MAP_DEM_MAX_ZOOM } from './protocol/dem';
import { MARS_RADIUS_M } from '@/lib/constants';

/**
 * The map library draws every planet at Earth's size, while the elevation tiles hold Mars metres: on its
 * own, a mountain came out at 0.53 of its true height against the ground around it, and "x1.6 exaggerated"
 * was in fact flatter than Mars. The terrain is stretched by this ratio too, so the factor the chip shows is
 * the one the visitor sees.
 */
const GLOBE_SCALE = 6_371_008.8 / MARS_RADIUS_M;

const SOURCE_DEM = 'dem';
const SOURCE_SHADE = 'dem-shade';
const DEM_TILES = ['mars://dem/{z}/{x}/{y}'];

let exaggeration = 1;
const listeners = new Set<(factor: number) => void>();

export function getExaggeration(): number {
  return exaggeration;
}

export function onExaggeration(cb: (factor: number) => void): () => void {
  listeners.add(cb);
  cb(exaggeration);
  return () => listeners.delete(cb);
}

/**
 * 3D terrain and sun-lit shading. The relief is stretched by zoom (see engines/relief), the shading
 * follows the app clock’s sun at the map centre, and the imagery dims toward night.
 */
export function addTerrain(map: MapLibreMap): () => void {
  // Terrain and hillshade read the same tiles through two sources, as the library recommends.
  const dem = { type: 'raster-dem' as const, tiles: DEM_TILES, tileSize: 256, encoding: 'terrarium' as const, maxzoom: MAP_DEM_MAX_ZOOM };
  if (!map.getSource(SOURCE_DEM)) map.addSource(SOURCE_DEM, dem);
  if (!map.getSource(SOURCE_SHADE)) map.addSource(SOURCE_SHADE, dem);
  if (!map.getLayer('hillshade')) {
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: SOURCE_SHADE,
        paint: {
          'hillshade-exaggeration': 0.6,
          'hillshade-shadow-color': '#1a0f08',
          // A warm, faint highlight: a cream one washed the sunlit slopes out to beige.
          'hillshade-highlight-color': 'rgba(214, 150, 100, 0.35)',
          'hillshade-accent-color': '#2a1a10',
          'hillshade-illumination-anchor': 'map',
        },
      },
      map.getLayer('region-outline') ? 'region-outline' : undefined,
    );
  }

  // The stretch handed to the map library, which also lifts the ground's absolute height: on the volcanoes
  // (Olympus Mons stands 21 km up) a full stretch put the ground above the camera and the screen went black. So
  // the stretch is held under what keeps the ground in view below LIFT_LIMIT_M, never less than the old factor.
  let applied = 0;
  const LIFT_LIMIT_M = 45_000;
  const applyRelief = () => {
    const want = reliefExaggeration(map.getZoom());
    const raw = applied > 0 ? map.queryTerrainElevation(map.getCenter()) : null;
    const elev = raw !== null && raw !== undefined && applied > 0 ? Math.abs(raw / applied) : 0;
    const full = want * GLOBE_SCALE;
    const safe = Math.max(want, Math.min(full, LIFT_LIMIT_M / Math.max(1, elev)));
    const next = Math.round(safe * 20) / 20;
    if (next === applied && map.getTerrain()) return;
    applied = next;
    map.setTerrain({ source: SOURCE_DEM, exaggeration: next });
    // The chip says how much taller than true the ground stands, against the ground around it.
    exaggeration = Math.round((next / GLOBE_SCALE) * 10) / 10;
    for (const cb of listeners) cb(exaggeration);
  };

  const applyLight = () => {
    const c = map.getCenter();
    const app = useApp.getState();
    const sun = sunPosition(app.utcMs, c.lat, c.lng);
    // The map is lit from the north-west at mid-morning height so it always reads. The real Sun lights it
    // when the visitor asks for that in Layers, or has picked an hour on the Mars clock to see its light.
    const realSun = app.layers.followSun || !app.clockLive;
    const light = realSun ? mapLighting(sun.elevDeg, sun.azDeg) : mapLighting(42, 315);
    // On the globe the planet is shown fully lit: night would hide the place the visitor came to see.
    const zoomedIn = map.getZoom() >= 6;
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', light.direction);
    // Close in, the imagery carries its own light and shade at metres; the shading from the coarser elevation
    // would only lay its blocky cells over it, so it fades out past zoom 14.
    const z = map.getZoom();
    const closeFade = z <= 14 ? 1 : z >= 16.5 ? 0.12 : 1 - ((z - 14) / 2.5) * 0.88;
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', zoomedIn ? light.strength * closeFade : 0.35);
    // Night is dimmed to 0.6, not the 0.4 of the lighting model: a first-time visitor who arrives
    // during the Martian night still has to be able to read the map.
    const bright = zoomedIn ? Math.max(0.6, light.brightness) : 1;
    map.setPaintProperty('base', 'raster-brightness-max', bright);
    if (map.getLayer('hirise-hd')) map.setPaintProperty('hirise-hd', 'raster-brightness-max', bright);
    map.setSky({
      'sky-color': light.sky,
      'horizon-color': light.horizon,
      'fog-color': light.horizon,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      // Haze lies over the far ground only; close in, a tilted view would otherwise be washed out to cream.
      'fog-ground-blend': ['interpolate', ['linear'], ['zoom'], 9, 0.25, 13, 0.6, 16, 0.9],
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 4, 0.55, 6.5, 0],
    });
  };

  let lastZoomBucket = -1;
  const onZoom = () => {
    const bucket = Math.round(map.getZoom() * 4);
    if (bucket !== lastZoomBucket) {
      lastZoomBucket = bucket;
      applyRelief();
      applyLight();
    }
  };
  map.on('zoom', onZoom);
  map.on('moveend', applyLight);
  map.on('moveend', applyRelief);
  // The height under the camera is known only once its elevation tiles are in.
  map.on('idle', applyRelief);
  // The clock moves every second; the sun does not move visibly that fast.
  const offClock = useApp.subscribe((s) => Math.floor(s.utcMs / 60_000), applyLight);
  const offDaylight = useApp.subscribe((s) => s.layers.followSun || !s.clockLive, applyLight);
  const unsubscribe = () => {
    offClock();
    offDaylight();
  };
  applyRelief();
  applyLight();

  return () => {
    map.off('zoom', onZoom);
    map.off('moveend', applyLight);
    map.off('moveend', applyRelief);
    map.off('idle', applyRelief);
    unsubscribe();
  };
}
