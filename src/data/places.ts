import { distanceM, bearingDeg } from '@/lib/geo';
import { fmtLatLon } from '@/lib/format';
import { loadNames, loadPlaces, loadSamples, loadSites, type NamedFeature, type Place, type PlacePhoto, type SampleCore } from './datasets';

/** Everything the place card needs about one spot, whatever kind of thing it is. */
export interface PlaceView {
  /** "place:<id>", "sample:<id>", "feature:<id>", "site:<id>" or "@lat,lon". */
  key: string;
  kind: 'place' | 'sample' | 'feature' | 'site' | 'point';
  name: string;
  /** One line under the name saying what it is. */
  subtitle: string;
  lon: number;
  lat: number;
  summary: string;
  detail?: string;
  photos: PlacePhoto[];
  sol?: number;
  /** A zoom that frames it. */
  zoom: number;
}

const TYPE_WORDS: Record<string, string> = {
  crater: 'crater',
  vallis: 'valley',
  valles: 'valley system',
  fossa: 'trough',
  fossae: 'set of troughs',
  mons: 'mountain',
  montes: 'mountain range',
  planitia: 'low plain',
  planum: 'high plain',
  terra: 'highland region',
  mensa: 'flat-topped hill',
  mensae: 'group of flat-topped hills',
  rupes: 'cliff',
  dorsum: 'ridge',
  dorsa: 'group of ridges',
  patera: 'shallow volcanic crater',
  tholus: 'domed hill',
  cavus: 'steep-sided hollow',
  cavi: 'group of hollows',
  collis: 'small hill',
  colles: 'group of small hills',
  chaos: 'area of broken ground',
  palus: 'small plain',
  catena: 'chain of craters',
  sulcus: 'set of furrows',
  sulci: 'set of furrows',
  labyrinthus: 'maze of valleys',
  scopulus: 'lobed cliff',
  vastitas: 'wide lowland',
};

export function typeWord(type: string): string {
  return TYPE_WORDS[type.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? type.toLowerCase();
}

function sizeText(km: number): string {
  if (!(km > 0)) return '';
  if (km >= 10) return `${Math.round(km)} km`;
  return `${km.toFixed(1)} km`;
}

function fromFeature(f: NamedFeature): PlaceView {
  const word = typeWord(f.type);
  const size = sizeText(f.diameterKm);
  const article = /^[aeiou]/.test(word) ? 'an' : 'a';
  return {
    key: `feature:${f.id}`,
    kind: 'feature',
    name: f.name,
    subtitle: size ? `${word.charAt(0).toUpperCase()}${word.slice(1)}, ${size} across` : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    lon: f.lon,
    lat: f.lat,
    summary: size
      ? `${f.name} is ${article} ${word} about ${size} across. The name is official, approved by the International Astronomical Union.`
      : `${f.name} is ${article} ${word}. The name is official, approved by the International Astronomical Union.`,
    photos: [],
    zoom: f.diameterKm > 0 ? Math.max(4, Math.min(13, 15.2 - Math.log2(f.diameterKm * 2.2))) : 11,
  };
}

function fromPlace(p: Place): PlaceView {
  return {
    key: `place:${p.id}`,
    kind: p.kind === 'site' ? 'site' : 'place',
    name: p.name,
    subtitle: p.sol !== undefined ? `Visited by Perseverance on sol ${p.sol}` : 'Perseverance site',
    lon: p.lon,
    lat: p.lat,
    summary: p.summary,
    ...(p.detail ? { detail: p.detail } : {}),
    photos: p.photos,
    ...(p.sol !== undefined ? { sol: p.sol } : {}),
    zoom: 14.5,
  };
}

function fromSample(s: SampleCore): PlaceView {
  return {
    key: `sample:${s.id}`,
    kind: 'sample',
    name: s.name,
    subtitle: `Sample collected on sol ${s.sol}, ${s.campaign} campaign`,
    lon: s.lon,
    lat: s.lat,
    summary: s.note,
    detail: `Rock type: ${s.rock}.`,
    photos: [],
    sol: s.sol,
    zoom: 15,
  };
}

/** Resolves a key to a view, or null if nothing by that key exists. Never rejects. */
export async function resolvePlace(key: string): Promise<PlaceView | null> {
  try {
    if (key.startsWith('@')) {
      const [latText, lonText] = key.slice(1).split(',');
      const lat = Number(latText);
      const lon = Number(lonText);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
      return { key, kind: 'point', name: 'Dropped pin', subtitle: fmtLatLon(lat, lon), lon, lat, summary: '', photos: [], zoom: 13 };
    }
    const sep = key.indexOf(':');
    const type = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (type === 'place') {
      const p = (await loadPlaces()).find((x) => x.id === id);
      return p ? fromPlace(p) : null;
    }
    if (type === 'sample') {
      const s = (await loadSamples()).find((x) => x.id === id);
      return s ? fromSample(s) : null;
    }
    if (type === 'feature') {
      const f = (await loadNames()).find((x) => x.id === id);
      return f ? fromFeature(f) : null;
    }
    if (type === 'site') {
      const s = (await loadSites()).find((x) => x.id === id);
      if (!s) return null;
      const mission = typeof s.mission === 'string' ? s.mission : s.name;
      const date = typeof s.date === 'string' ? s.date : '';
      return {
        key,
        kind: 'site',
        name: s.name,
        subtitle: date ? `Landing site of ${mission}, ${date}` : `Landing site of ${mission}`,
        lon: s.lon,
        lat: s.lat,
        summary: s.note,
        photos: [],
        zoom: 9,
      };
    }
  } catch {
    // A dataset that fails to load only means the place cannot be shown.
  }
  return null;
}

export interface Neighbour {
  key: string;
  name: string;
  hint: string;
  distM: number;
  /** Compass direction from the reference point, e.g. "north-west". */
  direction: string;
  lon: number;
  lat: number;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

export function compassWord(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8] ?? 'north';
}

/** Named things around a point, nearest first. Loads what it can; a missing dataset is skipped. */
export async function nearby(lon: number, lat: number, excludeKey: string, maxM = 40_000, limit = 6): Promise<Neighbour[]> {
  const [places, samples, names] = await Promise.all([
    loadPlaces().catch(() => [] as Place[]),
    loadSamples().catch(() => [] as SampleCore[]),
    loadNames().catch(() => [] as NamedFeature[]),
  ]);
  const out: Neighbour[] = [];
  const push = (key: string, name: string, hint: string, lo: number, la: number) => {
    if (key === excludeKey) return;
    const distM = distanceM(lon, lat, lo, la);
    if (distM <= maxM) out.push({ key, name, hint, distM, direction: compassWord(bearingDeg(lon, lat, lo, la)), lon: lo, lat: la });
  };
  for (const p of places) push(`place:${p.id}`, p.name, 'Perseverance site', p.lon, p.lat);
  for (const s of samples) push(`sample:${s.id}`, s.name, 'Rock sample', s.lon, s.lat);
  // A feature counts as near when its edge is, not only its centre.
  for (const f of names) {
    if (f.diameterKm > 600) continue;
    const key = `feature:${f.id}`;
    if (key === excludeKey) continue;
    const centre = distanceM(lon, lat, f.lon, f.lat);
    const edge = Math.max(0, centre - (f.diameterKm * 1000) / 2);
    if (edge <= maxM) {
      out.push({ key, name: f.name, hint: typeWord(f.type), distM: centre, direction: compassWord(bearingDeg(lon, lat, f.lon, f.lat)), lon: f.lon, lat: f.lat });
    }
  }
  out.sort((a, b) => a.distM - b.distM);
  // The same spot often carries a site and a sample of the same name; keep the first of each name.
  const seen = new Set<string>();
  return out.filter((n) => (seen.has(n.name) ? false : (seen.add(n.name), true))).slice(0, limit);
}

/** The named feature a point lies inside, smallest first: "in Jezero", "in Nili Fossae". */
export async function containingFeature(lon: number, lat: number): Promise<NamedFeature | null> {
  const names = await loadNames().catch(() => [] as NamedFeature[]);
  let best: NamedFeature | null = null;
  for (const f of names) {
    if (!(f.diameterKm > 0) || f.diameterKm > 1500) continue;
    if (distanceM(lon, lat, f.lon, f.lat) <= (f.diameterKm * 1000) / 2 && (!best || f.diameterKm < best.diameterKm)) best = f;
  }
  return best;
}
