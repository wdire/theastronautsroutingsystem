/** Formatting for the UI: plain English, numbers with units. */

const MINUS = '−';
const NBSP = ' ';

function fixed(v: number, digits: number): string {
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? MINUS + s : s;
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return 'n/a';
  const a = Math.abs(m);
  if (a < 995) return `${fixed(a < 100 ? Math.round(m) : Math.round(m / 5) * 5, 0)}${NBSP}m`;
  if (a < 99_950) return `${fixed(m / 1000, 1)}${NBSP}km`;
  return `${fixed(m / 1000, 0)}${NBSP}km`;
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'n/a';
  const total = Math.max(0, Math.round(seconds / 60));
  if (total < 60) return `${total}${NBSP}min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h >= 48) {
    const sols = seconds / 88_775.244;
    return `${sols.toFixed(1)}${NBSP}sols`;
  }
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h ${m}${NBSP}min`;
}

/** Local true solar time from decimal hours, e.g. 14.53 to "14:32". */
export function fmtClock(hours: number): string {
  if (!Number.isFinite(hours)) return '--:--';
  const total = Math.round((((hours % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function fmtElevation(m: number): string {
  return Number.isFinite(m) ? `${fixed(Math.round(m), 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${NBSP}m` : 'n/a';
}

export function fmtTemp(c: number): string {
  return Number.isFinite(c) ? `${fixed(Math.round(c), 0)}${NBSP}°C` : 'n/a';
}

export function fmtDeg(d: number, digits = 0): string {
  return Number.isFinite(d) ? `${fixed(d, digits)}°` : 'n/a';
}

export function fmtLatLon(lat: number, lon: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}°${NBSP}${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}°${NBSP}${lon >= 0 ? 'E' : 'W'}`;
}

export function fmtNumber(v: number, digits = 0): string {
  return Number.isFinite(v) ? fixed(v, digits) : 'n/a';
}

export function fmtPercent(frac: number): string {
  return Number.isFinite(frac) ? `${Math.round(frac * 100)}%` : 'n/a';
}

/** "Safest, fastest and eco" from a list. */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const UTC_STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

/** "13 Nov, 12:00 UTC" */
export function fmtUtc(utcMs: number): string {
  return `${UTC_STAMP.format(utcMs)} UTC`;
}
