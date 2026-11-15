import { Map as MapLibreMap, setMaxParallelImageRequests, setWorkerUrl } from 'maplibre-gl';
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
  // Every tile goes through the mars:// protocol, which keeps its own limits on the network (per service, and
  // for the app's server); the library's default of 16 requests at a time only queued fast tiles behind slow ones.
  setMaxParallelImageRequests(64);
  registerMarsProtocol();
  const view = globeView();
  const instance = new MapLibreMap({
    container,
    style: baseStyle(),
    center: view.center,
    zoom: view.zoom,
    minZoom: 0.8,
    maxZoom: 19,
    maxPitch: 80,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: true,
    fadeDuration: 0,
    // No multisampling: on a high-density screen it holds four copies of a 5-megapixel canvas in graphics memory
    // for edges its pixels are already too small to show stepped, and drawn in software (no graphics card, the
    // test browsers) it made every frame four times the work. Lines are smoothed by their own shader.
    canvasContextAttributes: { antialias: false },
    // Tiles kept after they leave the view, per source: by default five zoom levels of a screenful, which on a
    // high-density screen is hundreds of textures per layer. Tiles come back from the protocol's own caches.
    maxTileCacheZoomLevels: 2,
    maxTileCacheSize: 96,
  });
  instance.setPadding(view.padding);
  map = instance;
  window.__areoMap = instance;

  instance.on('load', () => {
    // Drawn in software (no graphics card, or a headless test browser) every frame of a fading tile costs a
    // few hundred milliseconds of the page's only thread: tiles appear at once instead.
    if (softwareGl(instance)) for (const id of ['base', 'hirise-hd']) if (instance.getLayer(id)) instance.setPaintProperty(id, 'raster-fade-duration', 0);
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

/** Whether the map is drawn by a software renderer (SwiftShader, llvmpipe) rather than a graphics card. */
function softwareGl(instance: MapLibreMap): boolean {
  try {
    const gl = instance.getCanvas().getContext('webgl2') ?? instance.getCanvas().getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

export function destroyMap(): void {
  map?.remove();
  map = null;
  delete window.__areoMap;
  readyCallbacks.length = 0;
}
