import { M20_TRAVERSE_URL, M20_WAYPOINTS_URL, parseM20 } from '../src/data/traverseFeed';

export const config = { runtime: 'edge' };

/**
 * GET /api/traverse: Perseverance's drive as NASA last published it, in the app's own shape, cached
 * for six hours. The rover is still driving; the copy bundled in public/data is the fallback.
 */
export default async function handler(): Promise<Response> {
  try {
    const [t, w] = await Promise.all(
      [M20_TRAVERSE_URL, M20_WAYPOINTS_URL].map((url) => fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null))),
    );
    const traverse = parseM20(t, w);
    if (!traverse) throw new Error('empty');
    return new Response(JSON.stringify(traverse), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=21600, stale-while-revalidate=86400' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'NASA’s rover location service did not answer' }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
