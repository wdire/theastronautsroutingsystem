import type { DonkiFeed } from '@/engines/spaceWeather';
import { tryFetchJson } from './datasets';
import { CCMC, fetchDonki, isDonkiFeed } from './donki';

const STORAGE_KEY = 'areo.spaceweather.v1';
/** DONKI changes a few times a day; half an hour keeps the app polite to NASA's servers. */
export const MAX_AGE_MS = 30 * 60_000;

function readCache(): DonkiFeed | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const feed: unknown = raw ? JSON.parse(raw) : null;
    return isDonkiFeed(feed) ? feed : null;
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

/**
 * NASA's space weather feeds: the copy kept in this browser while it is under half an hour old, else a
 * fresh answer. The app's own function is asked first (one cached answer for every visitor); on a plain
 * static host it is absent, and NASA is asked directly. If nothing answers, the old copy if there is
 * one, however old; the summary shows when it was fetched. Null only when there is nothing at all.
 */
export async function loadSpaceWeather(nowMs: number, signal: AbortSignal): Promise<DonkiFeed | null> {
  const cached = readCache();
  if (cached && Math.abs(nowMs - Date.parse(cached.fetched)) < MAX_AGE_MS) return cached;
  let fresh: unknown = await tryFetchJson('/api/spaceweather', signal);
  if (!isDonkiFeed(fresh)) fresh = await fetchDonki([{ base: CCMC }], nowMs, signal);
  if (!isDonkiFeed(fresh)) return cached;
  writeCache(fresh);
  return fresh;
}
