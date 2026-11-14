/** Mars and region constants. Values are fixed by docs/build-spec.md. */
export const MARS_RADIUS_M = 3_396_190;
export const MARS_G = 3.71;
export const SOL_S = 88_775.244;
export const EARTH_DAY_S = 86_400;

/** [west, south, east, north] in degrees, east-positive longitude. */
export type Box = readonly [w: number, s: number, e: number, n: number];

export const REGION: Box = [71.8, 13.1, 83.1, 23.8];
export const CORE: Box = [76.2, 17.3, 78.7, 19.6];
export const REGION_CENTER = [77.45, 18.45] as const;

/** Octavia E. Butler Landing, where Perseverance touched down. */
export const LANDING_SITE = [77.4509, 18.4446] as const;

export function inBox(box: Box, lon: number, lat: number): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}
