import type { WeatherSol } from './datasets';

export type Station = 'rems' | 'meda';

/** What /api/weather answers: the newest sols that carry numbers, oldest first. */
export interface StationReport {
  station: Station;
  fetched: string;
  sols: WeatherSol[];
}

/** The feeds write numbers as strings or numbers, and "--" where the instrument has nothing. */
function reading(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/**
 * Reads a mars.nasa.gov weather feed (Curiosity’s lists `soles`, Perseverance’s `sols`) and keeps the
 * newest `keep` sols that have a temperature or a pressure. Values outside what Mars can do are feed
 * glitches and are dropped. Anything unreadable gives an empty list.
 */
export function parseStationFeed(feed: unknown, keep = 3): WeatherSol[] {
  if (typeof feed !== 'object' || feed === null) return [];
  const f = feed as Record<string, unknown>;
  const rows = Array.isArray(f.soles) ? f.soles : Array.isArray(f.sols) ? f.sols : [];
  const sols: WeatherSol[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const sol = reading(r.sol, 0, 1e6);
    const earthDate = typeof r.terrestrial_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.terrestrial_date) ? r.terrestrial_date : null;
    if (sol === null || earthDate === null) continue;
    const minC = reading(r.min_temp, -140, 40);
    const maxC = reading(r.max_temp, -140, 40);
    const pressurePa = reading(r.pressure, 500, 1200);
    if (minC === null && maxC === null && pressurePa === null) continue;
    sols.push({ sol, earthDate, minC, maxC, pressurePa });
  }
  sols.sort((a, b) => a.sol - b.sol);
  return sols.slice(-keep);
}
