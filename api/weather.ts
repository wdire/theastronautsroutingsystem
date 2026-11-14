import { parseStationFeed, type Station, type StationReport } from '../src/data/stationFeed';

export const config = { runtime: 'edge' };

/** The rovers' weather reports. mars.nasa.gov sends no CORS headers, so the browser cannot ask it directly. */
const STATIONS: Record<Station, string> = {
  rems: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
  meda: 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
};

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });
}

/**
 * GET /api/weather?station=rems|meda: the station's newest sols with readings, cached for an hour.
 * Curiosity's feed is every sol since 2012; only the last few are passed on.
 */
export default async function handler(request: Request): Promise<Response> {
  const station = new URL(request.url).searchParams.get('station') ?? '';
  if (station !== 'rems' && station !== 'meda') return json({ error: 'station must be rems or meda' }, 400, 'no-store');
  const url = STATIONS[station];
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const sols = upstream.ok ? parseStationFeed(JSON.parse(await upstream.text())) : [];
    if (sols.length === 0) return json({ error: 'the station feed did not answer' }, 502, 'no-store');
    const report: StationReport = { station, fetched: new Date().toISOString(), sols };
    return json(report, 200, 'public, s-maxage=3600, stale-while-revalidate=86400');
  } catch {
    return json({ error: 'the station feed did not answer' }, 502, 'no-store');
  }
}
