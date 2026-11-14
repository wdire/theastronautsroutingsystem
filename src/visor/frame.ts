import { MARS_RADIUS_M } from '@/lib/constants';

const RAD = Math.PI / 180;

/**
 * The visor's local frame: metres on a plane touching Mars at an origin.
 * x points east, z points south (so north is -z, as three.js cameras expect), y is up.
 */
export interface Frame {
  lon0: number;
  lat0: number;
  /** Elevation of the origin; scene heights are relative to it. */
  base: number;
}

export function toLocal(frame: Frame, lon: number, lat: number): [x: number, z: number] {
  return [(lon - frame.lon0) * RAD * MARS_RADIUS_M * Math.cos(frame.lat0 * RAD), -(lat - frame.lat0) * RAD * MARS_RADIUS_M];
}

export function toLonLat(frame: Frame, x: number, z: number): [lon: number, lat: number] {
  return [frame.lon0 + x / (RAD * MARS_RADIUS_M * Math.cos(frame.lat0 * RAD)), frame.lat0 - z / (RAD * MARS_RADIUS_M)];
}

/** How far the planet's surface has fallen away below the tangent plane at a distance from the origin, m. */
export function curvatureDrop(x: number, z: number): number {
  return (x * x + z * z) / (2 * MARS_RADIUS_M);
}

/** Compass bearing (degrees clockwise from north) of a direction in the local frame. */
export function bearingOf(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}
