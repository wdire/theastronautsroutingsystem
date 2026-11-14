import { donkiQueries, parseDonkiList, type DonkiFeed, type FeedName } from '@/engines/spaceWeather';

/** The database's own server at Goddard: answers browsers directly (CORS) and needs no key. */
export const CCMC = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/';
/** NASA's API gateway: the same feeds behind a key. */
export const GATEWAY = 'https://api.nasa.gov/DONKI/';

const FEED_NAMES: readonly FeedName[] = ['enlil', 'sep', 'flr'];
const TIMEOUT_MS = 12_000;

async function ask(url: string, signal?: AbortSignal): Promise<unknown[] | null> {
  try {
    const limit = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, limit]) : limit });
    return response.ok ? parseDonkiList(await response.text()) : null;
  } catch {
    return null;
  }
}

/**
 * The three DONKI feeds in one object. `sources` are base URLs tried in order for each feed, each
 * with an optional query suffix (a key); a feed that no source answers is null. Feeds are asked together.
 * Used by the function under api/ and, as a fallback, by the browser.
 */
export async function fetchDonki(sources: readonly { base: string; suffix?: string }[], nowMs: number, signal?: AbortSignal): Promise<DonkiFeed> {
  const queries = donkiQueries(nowMs);
  const feed: DonkiFeed = { fetched: new Date(nowMs).toISOString(), enlil: null, sep: null, flr: null };
  await Promise.all(
    FEED_NAMES.map(async (name) => {
      const { path, query } = queries[name];
      for (const source of sources) {
        const list = await ask(`${source.base}${path}?${query}${source.suffix ?? ''}`, signal);
        if (list) {
          feed[name] = list;
          return;
        }
      }
    }),
  );
  return feed;
}

/** True when at least one feed answered and nothing in the object is the wrong shape. */
export function isDonkiFeed(v: unknown): v is DonkiFeed {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.fetched === 'string' && FEED_NAMES.every((n) => f[n] === null || Array.isArray(f[n])) && FEED_NAMES.some((n) => Array.isArray(f[n]));
}
