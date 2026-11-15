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
        // On a high-density screen, tiles one level finer than the zoom, so the ground is as sharp as the
        // screen can show (at 256 each image would be stretched to twice its pixels).
        tileSize: typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 128 : 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: 'NASA / JPL-Caltech / USGS / MSSS / ASU',
      },
      // The 25 cm Jezero mosaic, drawn over the base from zoom 14 (13 on a high-density screen) where it covers
      // the ground: even shrunk to 10 m a pixel it is crisper than the 20 m orbital mosaic under it.
      hd: {
        type: 'raster',
        tiles: ['mars://hd/{z}/{x}/{y}'],
        tileSize: typeof window !== 'undefined' && window.devicePixelRatio >= 1.5 ? 128 : 256,
        minzoom: 14,
        maxzoom: 19,
        bounds: [77.2, 18.3, 77.6, 18.68],
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
      // Jezero’s floor is dark basalt: the image is lifted a little so its shapes read on a screen. Contrast is
      // strong from afar, where it gives the landforms body, and slight close in, where it crushed dark sand to black.
      {
        id: 'base',
        type: 'raster',
        source: SOURCE_BASE,
        paint: { 'raster-fade-duration': 180, 'raster-resampling': 'linear', 'raster-contrast': ['interpolate', ['linear'], ['zoom'], 10, 0.22, 14, 0.12, 16, 0.02], 'raster-saturation': 0.26, 'raster-brightness-min': ['interpolate', ['linear'], ['zoom'], 12, 0.02, 16, 0.07] },
      },
      {
        id: 'hirise-hd',
        type: 'raster',
        source: 'hd',
        minzoom: 13,
        paint: { 'raster-fade-duration': 450, 'raster-resampling': 'linear', 'raster-contrast': ['interpolate', ['linear'], ['zoom'], 10, 0.22, 14, 0.12, 16, 0.02], 'raster-saturation': 0.26, 'raster-brightness-min': ['interpolate', ['linear'], ['zoom'], 12, 0.02, 16, 0.07] },
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
