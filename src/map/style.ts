import type { StyleSpecification } from 'maplibre-gl';
import { REGION } from '@/lib/constants';

export const SOURCE_BASE = 'base';
export const SOURCE_REGION = 'region-outline';

const [w, s, e, n] = REGION;

/** The base style: Mars imagery on a globe. Terrain, light and overlays are added by their own modules. */
export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'globe' },
    // A thin lit limb on the planet; gone by the time the ground fills the view.
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 4, 0.55, 6.5, 0] },
    sources: {
      [SOURCE_BASE]: {
        type: 'raster',
        tiles: ['mars://img/{z}/{x}/{y}'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 17,
        attribution: 'NASA / JPL-Caltech / USGS / MSSS / ASU',
      },
      [SOURCE_REGION]: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
        },
      },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': '#7a4a30' } },
      // Jezero’s floor is dark basalt: the image is lifted a little so its shapes read on a screen.
      {
        id: 'base',
        type: 'raster',
        source: SOURCE_BASE,
        paint: { 'raster-fade-duration': 180, 'raster-resampling': 'linear', 'raster-contrast': 0.14, 'raster-saturation': 0.16, 'raster-brightness-min': 0.03 },
      },
      {
        id: 'region-outline',
        type: 'line',
        source: SOURCE_REGION,
        paint: {
          'line-color': '#f3e7d8',
          'line-width': 1.2,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 5, 0.45, 6.5, 0],
        },
      },
    ],
  };
}
