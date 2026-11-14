import { CCMC, GATEWAY, fetchDonki, isDonkiFeed } from '../src/data/donki';

export const config = { runtime: 'edge' };

/**
 * GET /api/spaceweather: three DONKI feeds in one answer, cached for half an hour at the edge.
 * Each feed fails on its own (null). With a key the API gateway is asked first; the key never
 * leaves this function. Without one, or where the gateway does not answer, NASA's keyless server is used.
 */
export default async function handler(): Promise<Response> {
  const key = process.env.NASA_API_KEY;
  const sources = [...(key ? [{ base: GATEWAY, suffix: `&api_key=${encodeURIComponent(key)}` }] : []), { base: CCMC }];
  const feed = await fetchDonki(sources, Date.now());
  const ok = isDonkiFeed(feed);
  return new Response(JSON.stringify(feed), {
    status: ok ? 200 : 502,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ok ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'no-store',
    },
  });
}
