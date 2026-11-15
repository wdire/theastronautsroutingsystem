/**
 * The numbers Jezero Station is laid out from (src/visor/baseProps.ts draws it): one set of sizes, so every
 * tunnel meets what it joins. Kept apart from the drawing, which needs the 3D library, so the scene's layout
 * can read the footprint without loading it.
 */
/** Habitat geometry, m. The hub is a domed cylinder; the side modules and greenhouse are joined to it by tunnels. */
export const HUB_R = 7;
export const HUB_WALL = 3.6;
export const HUB_CAP = 3.6;
export const MODULE_R = 2.3;
export const MODULE_LEN = 9;
/** Where each side module's near end is, and its axis height. */
export const MODULE_NEAR = 11;
export const MODULE_Y = 2.8;
export const GREEN_R = 4.2;
export const GREEN_Z = 16;
/** How far a tunnel runs into what it joins, so no seam or gap ever shows. */
export const SINK = 0.6;


/** Discs on the ground the station stands on, [x, z, r] in its own frame: kept clear of rocks and of walkers. */
export const STATION_FOOTPRINT: readonly (readonly [number, number, number])[] = [
  [0, 0, HUB_R + 0.9],
  [0, -(HUB_R + 0.9), 2.1],
  ...[-1, 1].flatMap((s) => [
    [s * (MODULE_NEAR - 2.2), 0, 1.5] as const,
    [s * (MODULE_NEAR + 2.2), 0, MODULE_R + 0.6] as const,
    [s * (MODULE_NEAR + MODULE_LEN - 2.2), 0, MODULE_R + 0.6] as const,
    [s * (MODULE_NEAR + MODULE_LEN + 2.4), MODULE_R + 1.6, 2.3] as const,
  ]),
  [0, HUB_R + 2.4, 1.4],
  [0, GREEN_Z, GREEN_R + 0.5],
];

