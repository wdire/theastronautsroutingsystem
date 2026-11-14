import type { Map as MapLibreMap } from 'maplibre-gl';
import { reliefExaggeration } from '@/engines/relief';
import { mapLighting } from '@/engines/lighting';
import { sunPosition } from '@/engines/marsTime';
import { useApp } from '@/store';
import { DEM_MAX_ZOOM } from '@/data/dem';

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
 * follows the app clock's sun at the map centre, and the imagery dims toward night.
 */
export function addTerrain(map: MapLibreMap): () => void {
  // Terrain and hillshade read the same tiles through two sources, as the library recommends.
  const dem = { type: 'raster-dem' as const, tiles: DEM_TILES, tileSize: 256, encoding: 'terrarium' as const, maxzoom: DEM_MAX_ZOOM };
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
          'hillshade-highlight-color': '#ffe9cf',
          'hillshade-accent-color': '#2a1a10',
          'hillshade-illumination-anchor': 'map',
        },
      },
      map.getLayer('region-outline') ? 'region-outline' : undefined,
    );
  }

  const applyRelief = () => {
    const next = Math.round(reliefExaggeration(map.getZoom()) * 20) / 20;
    if (next === exaggeration && map.getTerrain()) return;
    exaggeration = next;
    map.setTerrain({ source: SOURCE_DEM, exaggeration: next });
    for (const cb of listeners) cb(next);
  };

  const applyLight = () => {
    const c = map.getCenter();
    const app = useApp.getState();
    const sun = sunPosition(app.utcMs, c.lat, c.lng);
    // "Full daylight" in the Layers panel lights the map from the north-west at mid-morning height.
    const light = app.layers.daylight ? mapLighting(42, 315) : mapLighting(sun.elevDeg, sun.azDeg);
    // On the globe the planet is shown fully lit: night would hide the place the visitor came to see.
    const zoomedIn = map.getZoom() >= 6;
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', light.direction);
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', zoomedIn ? light.strength : 0.35);
    // Night is dimmed to 0.6, not the 0.4 of the lighting model: a first-time visitor who arrives
    // during the Martian night still has to be able to read the map.
    map.setPaintProperty('base', 'raster-brightness-max', zoomedIn ? Math.max(0.6, light.brightness) : 1);
    map.setSky({
      'sky-color': light.sky,
      'horizon-color': light.horizon,
      'fog-color': light.horizon,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.25,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 4, 0.55, 6.5, 0],
    });
  };

  let lastZoomBucket = -1;
  const onZoom = () => {
    const bucket = Math.round(map.getZoom() * 4);
    if (bucket !== lastZoomBucket) {
      lastZoomBucket = bucket;
      applyRelief();
    }
  };
  map.on('zoom', onZoom);
  map.on('moveend', applyLight);
  // The clock moves every second; the sun does not move visibly that fast.
  const offClock = useApp.subscribe((s) => Math.floor(s.utcMs / 60_000), applyLight);
  const offDaylight = useApp.subscribe((s) => s.layers.daylight, applyLight);
  const unsubscribe = () => {
    offClock();
    offDaylight();
  };
  applyRelief();
  applyLight();

  return () => {
    map.off('zoom', onZoom);
    map.off('moveend', applyLight);
    unsubscribe();
  };
}
