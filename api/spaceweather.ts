import { donkiQueries, parseDonkiList, type DonkiFeed, type FeedName } from '../src/engines/spaceWeather';

export const config = { runtime: 'edge' };

/** NASA's API gateway (needs a key) and the database's own server at Goddard (needs none). */
const GATEWAY = 'https://api.nasa.gov/DONKI/';
const CCMC = 'https://ccmc.gsfc.nasa.gov/DONKI/WS/get/';

async function ask(url: string): Promise<unknown[] | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    return response.ok ? parseDonkiList(await response.text()) : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/spaceweather: three DONKI feeds in one answer, cached for half an hour at the edge.
 * Each feed fails on its own (null). The key never leaves this function.
 */
export default async function handler(): Promise<Response> {
  const key = process.env.NASA_API_KEY || 'DEMO_KEY';
  const queries = donkiQueries(Date.now());
  const names = Object.keys(queries) as FeedName[];
  const lists = await Promise.all(
    names.map(async (name) => {
      const { path, query } = queries[name];
      return (await ask(`${GATEWAY}${path}?${query}&api_key=${encodeURIComponent(key)}`)) ?? (await ask(`${CCMC}${path}?${query}`));
    }),
  );
  const feed: DonkiFeed = { fetched: new Date().toISOString(), enlil: null, sep: null, flr: null };
  names.forEach((name, i) => {
    feed[name] = lists[i] ?? null;
  });
  const failed = lists.every((l) => l === null);
  return new Response(JSON.stringify(feed), {
    status: failed ? 502 : 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': failed ? 'no-store' : 'public, s-maxage=1800, stale-while-revalidate=3600',
    },
  });
}
