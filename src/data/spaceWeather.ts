import { donkiQueries, parseDonkiList, type DonkiFeed, type FeedName } from '@/engines/spaceWeather';

const STORAGE_KEY = 'areo.spaceweather.v1';
/** DONKI changes a few times a day; half an hour keeps the app polite to NASA’s servers. */
export const MAX_AGE_MS = 30 * 60_000;
/** The database’s own server at Goddard: answers browsers directly (CORS) and needs no key. */
const CCMC = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/';
const NAMES: readonly FeedName[] = ['enlil', 'sep', 'flr'];

function isFeed(v: unknown): v is DonkiFeed {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.fetched === 'string' && NAMES.every((n) => f[n] === null || Array.isArray(f[n])) && NAMES.some((n) => Array.isArray(f[n]));
}

function readCache(): DonkiFeed | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const feed: unknown = raw ? JSON.parse(raw) : null;
    return isFeed(feed) ? feed : null;
  } catch {
    return null;
  }
}

function writeCache(feed: DonkiFeed): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feed));
  } catch {
    // Storage is full or blocked: the next visit asks NASA again.
  }
}

/** The app’s own function: one cached answer for every visitor. Absent on a plain static host. */
async function fromFunction(signal: AbortSignal): Promise<DonkiFeed | null> {
  try {
    const response = await fetch('/api/spaceweather', { signal });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
    const feed: unknown = await response.json();
    return isFeed(feed) ? feed : null;
  } catch {
    return null;
  }
}

async function fromNasa(nowMs: number, signal: AbortSignal): Promise<DonkiFeed | null> {
  const queries = donkiQueries(nowMs);
  const lists = await Promise.all(
    NAMES.map(async (name) => {
      try {
        const response = await fetch(`${CCMC}${queries[name].path}?${queries[name].query}`, { signal });
        return response.ok ? parseDonkiList(await response.text()) : null;
      } catch {
        return null;
      }
    }),
  );
  const feed: DonkiFeed = { fetched: new Date(nowMs).toISOString(), enlil: lists[0] ?? null, sep: lists[1] ?? null, flr: lists[2] ?? null };
  return isFeed(feed) ? feed : null;
}

/**
 * NASA’s space weather feeds: the copy kept in this browser while it is under half an hour old, else a
 * fresh answer (the app’s function, then NASA directly). If nothing answers, the old copy if there is
 * one, however old; the summary shows when it was fetched. Null only when there is nothing at all.
 */
export async function loadSpaceWeather(nowMs: number, signal: AbortSignal): Promise<DonkiFeed | null> {
  const cached = readCache();
  if (cached && Math.abs(nowMs - Date.parse(cached.fetched)) < MAX_AGE_MS) return cached;
  const fresh = (await fromFunction(signal)) ?? (await fromNasa(nowMs, signal));
  if (fresh) writeCache(fresh);
  return fresh ?? cached;
}
