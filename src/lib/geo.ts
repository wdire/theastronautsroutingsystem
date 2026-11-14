import { MARS_RADIUS_M } from './constants';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** World pixel size of the Web Mercator square at a zoom, for 256 px tiles. */
export function worldSize(zoom: number): number {
  return 256 * 2 ** zoom;
}

export function lonToPx(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * worldSize(zoom);
}

export function latToPx(lat: number, zoom: number): number {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * RAD);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(zoom);
}

export function pxToLon(px: number, zoom: number): number {
  return (px / worldSize(zoom)) * 360 - 180;
}

export function pxToLat(py: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * py) / worldSize(zoom);
  return Math.atan(Math.sinh(n)) * DEG;
}

/** Ground metres per pixel at a latitude and zoom, on Mars. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (Math.cos(lat * RAD) * 2 * Math.PI * MARS_RADIUS_M) / worldSize(zoom);
}

/** Great-circle distance in metres on Mars. */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north, 0 to 360. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** The point a distance and bearing away. */
export function destination(lon: number, lat: number, bearing: number, distM: number): [number, number] {
  const d = distM / MARS_RADIUS_M;
  const b = bearing * RAD;
  const p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 * DEG, p2 * DEG];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles in degrees, -180 to 180. */
export function angleDiff(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/** 0 below `lo`, 1 above `hi`, and an S-shaped ease between. */
export function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
