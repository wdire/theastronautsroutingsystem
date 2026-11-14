import type { PathPoint } from '@/engines/types';
import type { GeologyData } from '@/engines/geology';

/** Typed loaders for the JSON under /data. Each file is fetched once and shared. */

export interface NamedFeature {
  id: string;
  name: string;
  /** IAU feature type, e.g. "Crater", "Vallis". */
  type: string;
  lon: number;
  lat: number;
  diameterKm: number;
  minZoom: number;
}

export interface PlacePhoto {
  src: string;
  caption: string;
  camera: string;
  sol: number;
  credit: string;
}

export interface Place {
  id: string;
  name: string;
  kind: 'm20' | 'sample' | 'site';
  lon: number;
  lat: number;
  elev: number;
  sol?: number;
  summary: string;
  detail?: string;
  photos: PlacePhoto[];
}

export interface SampleCore {
  id: string;
  name: string;
  sol: number;
  lon: number;
  lat: number;
  rock: string;
  campaign: string;
  note: string;
}

export interface Traverse {
  rover: string;
  name: string;
  path: PathPoint[];
  waypoints: { sol: number; lon: number; lat: number; elev: number; distKm: number }[];
}

export interface PointOfInterest {
  id: string;
  name: string;
  lon: number;
  lat: number;
  note: string;
  [key: string]: unknown;
}

export interface WeatherSol {
  sol: number;
  earthDate: string;
  minC: number | null;
  maxC: number | null;
  pressurePa: number | null;
  uv?: string | null;
  sunrise?: string | null;
  sunset?: string | null;
}

export interface WeatherData {
  retrieved: string;
  rems: WeatherSol[];
  meda: WeatherSol[];
  stats?: Record<string, unknown>;
}

export interface SourceEntry {
  id: string;
  name: string;
  mission: string;
  product: string;
  url: string;
  licence: string;
  notes: string;
  retrieved: string;
}

const cache = new Map<string, Promise<unknown>>();

async function fetchJson(path: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(path);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()) as unknown;
      lastError = new Error(`${path} answered ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** A failed load is forgotten, so a later call tries again. */
function load<T>(path: string): Promise<T> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetchJson(path);
    hit.catch(() => cache.delete(path));
    cache.set(path, hit);
  }
  return hit as Promise<T>;
}

export const loadNames = () => load<NamedFeature[]>('/data/names.json');
export const loadPlaces = () => load<Place[]>('/data/places.json');
export const loadSamples = () => load<SampleCore[]>('/data/samples.json');
export const loadTraverse = () => load<Traverse>('/data/traverses/m20.json');
export const loadCaves = () => load<PointOfInterest[]>('/data/caves.json');
export const loadSites = () => load<PointOfInterest[]>('/data/sites.json');
export const loadWeather = () => load<WeatherData>('/data/weather.json');
export const loadSources = () => load<SourceEntry[]>('/data/sources.json');
export const loadGeology = () => load<GeologyData>('/data/geology.json');
