/** Parses coordinates typed into the search box. Returns null if the text is not a coordinate pair. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const cleaned = text
    .trim()
    .replace(/[°º]/g, ' ')
    .replace(/[−–]/g, '-')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');
  const m = /^(-?\d+(?:\.\d+)?)\s*([NSEW])?\s+(-?\d+(?:\.\d+)?)\s*([NSEW])?$/i.exec(cleaned);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const ha = m[2]?.toUpperCase();
  const hb = m[4]?.toUpperCase();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const isLat = (h?: string) => h === 'N' || h === 'S';
  const isLon = (h?: string) => h === 'E' || h === 'W';
  if ((isLat(ha) && isLat(hb)) || (isLon(ha) && isLon(hb))) return null;

  // Latitude first unless the letters say otherwise.
  const lonFirst = isLon(ha) || isLat(hb);
  let lat = lonFirst ? b : a;
  let lon = lonFirst ? a : b;
  const latH = lonFirst ? hb : ha;
  const lonH = lonFirst ? ha : hb;
  if (latH === 'S') lat = -Math.abs(lat);
  if (latH === 'N') lat = Math.abs(lat);
  if (lonH === 'W') lon = -Math.abs(lon);
  if (lonH === 'E') lon = Math.abs(lon);

  if (lat < -90 || lat > 90 || lon < -360 || lon > 360) return null;
  // Keep longitude in -180..180, east positive.
  if (lon > 180) lon -= 360;
  else if (lon < -180) lon += 360;
  return { lat, lon };
}
