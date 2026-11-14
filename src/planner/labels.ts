import { fmtLatLon } from '@/lib/format';

/** What a start or a stop is called in lists: its name, or its coordinates if it has none. */
export function stopLabel(stop: { name?: string; lon: number; lat: number }): string {
  return stop.name ?? fmtLatLon(stop.lat, stop.lon, 3);
}
