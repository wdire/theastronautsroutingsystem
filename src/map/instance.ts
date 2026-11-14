import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
// The library’s own lookup of its worker breaks under a bundler; hand it the bundled worker instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useApp } from '@/store';
import { baseStyle } from './style';
import { registerMarsProtocol } from './protocol';
import { globeView } from './camera';

declare global {
  interface Window {
    /** The map, for the tests and the demo console. */
    __areoMap?: MapLibreMap;
  }
}

let map: MapLibreMap | null = null;
const readyCallbacks: ((map: MapLibreMap) => void)[] = [];

export function getMap(): MapLibreMap | null {
  return map;
}

/** Runs once the style has loaded; immediately if it already has. */
export function whenMapReady(cb: (map: MapLibreMap) => void): void {
  if (map?.isStyleLoaded()) cb(map);
  else readyCallbacks.push(cb);
}

export function createMap(container: HTMLElement): MapLibreMap {
  if (map) return map;
  setWorkerUrl(workerUrl);
  registerMarsProtocol();
  const view = globeView();
  const instance = new MapLibreMap({
    container,
    style: baseStyle(),
    center: view.center,
    zoom: view.zoom,
    minZoom: 0.8,
    maxZoom: 17,
    maxPitch: 80,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: true,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  instance.setPadding(view.padding);
  map = instance;
  window.__areoMap = instance;

  instance.on('load', () => {
    for (const cb of readyCallbacks.splice(0)) cb(instance);
  });
  instance.on('moveend', () => {
    const c = instance.getCenter();
    useApp.getState().setCamera({
      lon: c.lng,
      lat: c.lat,
      zoom: instance.getZoom(),
      bearing: instance.getBearing(),
      pitch: instance.getPitch(),
    });
  });
  return instance;
}

export function destroyMap(): void {
  map?.remove();
  map = null;
  delete window.__areoMap;
  readyCallbacks.length = 0;
}
