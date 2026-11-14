/**
 * Pictures of a named place from NASA's Image and Video Library (images-api.nasa.gov): no key, open to the
 * browser, and much larger than the few frames shipped with each place. Asked when a place card opens.
 */
import { normalise } from './search';

export interface NasaImage {
  id: string;
  title: string;
  /** Small preview, a few hundred pixels across. */
  thumb: string;
  /** The library's page for the picture, with the full image and its caption. */
  page: string;
  date: string;
  /** An artist's view, not a photograph. */
  illustration: boolean;
}

interface Hit {
  data?: { nasa_id?: string; title?: string; date_created?: string; keywords?: string[]; description?: string }[];
  links?: { href?: string; rel?: string }[];
}

const cache = new Map<string, Promise<NasaImage[]>>();

/** Parses one answer: pictures that name the place in their title come first. Exported for the tests. */
export function parseImages(json: unknown, name: string, limit: number): NasaImage[] {
  const items = ((json as { collection?: { items?: Hit[] } })?.collection?.items ?? []) as Hit[];
  const want = normalise(name);
  const out: (NasaImage & { named: boolean })[] = [];
  for (const it of items) {
    const d = it.data?.[0];
    const thumb = it.links?.find((l) => l.rel === 'preview')?.href ?? it.links?.[0]?.href;
    if (!d?.nasa_id || !d.title || !thumb || !/^https:\/\//.test(thumb)) continue;
    const words = `${d.title} ${(d.keywords ?? []).join(' ')} ${(d.description ?? '').slice(0, 300)}`.toLowerCase();
    out.push({
      id: d.nasa_id,
      title: d.title,
      thumb,
      page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
      date: (d.date_created ?? '').slice(0, 10),
      illustration: /illustration|artist'?s (concept|rendering|impression)/.test(words),
      named: normalise(d.title).includes(want),
    });
  }
  out.sort((a, b) => Number(b.named) - Number(a.named));
  return out.slice(0, limit).map(({ named: _named, ...img }) => img);
}

/** Up to `limit` pictures of a place on Mars. Never rejects: no answer is an empty list. */
export function nasaImages(name: string, limit = 9): Promise<NasaImage[]> {
  const key = `${name}|${limit}`;
  let hit = cache.get(key);
  if (!hit) {
    const q = encodeURIComponent(`${name} Mars`);
    hit = fetch(`https://images-api.nasa.gov/search?q=${q}&media_type=image&page_size=24`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => (json ? parseImages(json, name, limit) : []))
      .catch(() => []);
    cache.set(key, hit);
    // An empty answer may have been a failure: ask again on the next visit.
    void hit.then((list) => (list.length === 0 ? cache.delete(key) : undefined));
  }
  return hit;
}
