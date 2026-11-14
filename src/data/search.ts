import { parseCoordinates } from '@/lib/coords';

export interface SearchItem {
  /** Unique across kinds, e.g. "place:cheyava-falls". */
  key: string;
  kind: 'place' | 'sample' | 'feature' | 'site' | 'coordinates';
  name: string;
  /** One short line under the name. */
  hint: string;
  lon: number;
  lat: number;
  /** A zoom that frames it. */
  zoom: number;
  /** Larger is more prominent; breaks ties. */
  weight: number;
}

/** Lower case, accents removed, punctuation to spaces. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(name: string, query: string): number {
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.split(' ').some((w) => w.startsWith(query))) return 60;
  if (name.includes(query)) return 40;
  // Every word of the query appears somewhere, in any order.
  const words = query.split(' ');
  if (words.length > 1 && words.every((w) => name.includes(w))) return 30;
  return 0;
}

/** Ranked matches for a query. Coordinates typed in full come first. */
export function searchItems(items: readonly SearchItem[], text: string, limit = 8): SearchItem[] {
  const out: SearchItem[] = [];
  const coords = parseCoordinates(text);
  if (coords) {
    out.push({
      key: `coordinates:${coords.lat},${coords.lon}`,
      kind: 'coordinates',
      name: `${Math.abs(coords.lat).toFixed(4)}° ${coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(coords.lon).toFixed(4)}° ${coords.lon >= 0 ? 'E' : 'W'}`,
      hint: 'Go to these coordinates',
      lon: coords.lon,
      lat: coords.lat,
      zoom: 13,
      weight: 0,
    });
  }
  const query = normalise(text);
  if (query.length === 0) return out;
  const ranked: { item: SearchItem; s: number }[] = [];
  for (const item of items) {
    const s = score(normalise(item.name), query);
    if (s > 0) ranked.push({ item, s });
  }
  ranked.sort((a, b) => b.s - a.s || b.item.weight - a.item.weight || a.item.name.localeCompare(b.item.name));
  for (const r of ranked) {
    if (out.length >= limit) break;
    out.push(r.item);
  }
  return out;
}
