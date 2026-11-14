/**
 * Links that arrive in NASA's feeds are shown only if they are https addresses on a nasa.gov host.
 * Anything else in a feed is dropped.
 */
export function nasaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'nasa.gov' || url.hostname.endsWith('.nasa.gov')) ? url.href : null;
  } catch {
    return null;
  }
}
