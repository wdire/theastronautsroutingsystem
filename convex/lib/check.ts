/**
 * Checks on what a client sends. Each failure is a ConvexError with a sentence the UI can show as it is,
 * because the validators on args only prove the type, not that a name is short enough or a plan small enough.
 */
import { ConvexError } from 'convex/values';

const encoder = new TextEncoder();

/** Trims, then insists on a length between min and max characters. Returns the trimmed text. */
export function text(value: string, label: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ConvexError(min === 1 ? `${label} can't be empty.` : `${label} needs at least ${min} characters.`);
  if (trimmed.length > max) throw new ConvexError(`${label} can be at most ${max} characters.`);
  return trimmed;
}

/** JSON the server stores without reading. Only its size matters here, so a huge paste can't fill the database. */
export function json(value: string, label: string, maxBytes: number): string {
  if (value.length === 0) throw new ConvexError(`${label} is empty.`);
  // A UTF-8 byte is at least one character, so a short string can skip the encode.
  if (value.length > maxBytes || encoder.encode(value).length > maxBytes) {
    throw new ConvexError(`${label} is too large (the limit is ${Math.round(maxBytes / 1024)} kB).`);
  }
  return value;
}

/** A time in Unix milliseconds. Mars missions here stay within a couple of centuries of now. */
export function time(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 8.64e15) throw new ConvexError(`${label} is not a valid time.`);
  return value;
}

/** Task ids become keys of the assignments record, so they must be safe as field names. */
export function taskId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) throw new ConvexError('That task id is not valid.');
  return value;
}

export function order(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new ConvexError('Walking order must be a whole number from 0 to 999.');
  return value;
}

export function where(value: { lon: number; lat: number; headingDeg: number; moving: boolean }) {
  const { lon, lat, headingDeg } = value;
  if (!Number.isFinite(lon) || lon < -360 || lon > 360) throw new ConvexError('Longitude is out of range.');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new ConvexError('Latitude is out of range.');
  if (!Number.isFinite(headingDeg) || Math.abs(headingDeg) > 3600) throw new ConvexError('Heading is out of range.');
  return value;
}
