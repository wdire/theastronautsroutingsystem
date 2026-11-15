import { STATION_FOOTPRINT } from './stationPlan';

export type ModelName = 'perseverance' | 'ingenuity' | 'sev' | 'habitat' | 'z2' | 'solar' | 'pad' | 'mast' | 'tunnel' | 'station';

export interface ModelSpec {
  /** The NASA model to load; null for the parts of a base drawn here (src/visor/baseProps.ts). */
  url: string | null;
  /** The file's units to metres. */
  scale: number;
  /** Turn about the vertical so the model's front faces north (-z) before any heading is applied. */
  yawDeg: number;
  /** Wheel track and wheelbase in metres for vehicles that rest on wheels; null for things that stand level. */
  stance: { width: number; length: number } | null;
  /** The radius it takes up on the ground, m: rocks and the viewer stay outside it. */
  clearM: number;
  /**
   * For something too large and uneven for one disc: the discs it stands on, [x, z, r] in its own frame (x to
   * the right, front to -z). They replace `clearM` for rocks and walkers, and it stands level at their mean height.
   */
  footprint?: readonly (readonly [number, number, number])[];
  /**
   * Wheels to cut out of the model so they can turn: either every triangle of a named node, sorted
   * into `count` wheels by place, or the triangles inside a cylinder at each of `at` (centres in the
   * loaded model's own frame: metres, x to the right, front to -z).
   */
  wheels?: { radius: number; halfWidth: number } & ({ node: string; count: number } | { at: readonly (readonly [number, number, number])[] });
}

/** NASA 3D Resources models, optimised by tools/build_models.py. Sizes checked against the real hardware. */
export const MODELS: Record<ModelName, ModelSpec> = {
  perseverance: { url: '/models/perseverance.glb', scale: 1, yawDeg: 180, stance: { width: 2.4, length: 2.6 }, clearM: 3.2, wheels: { node: 'Wheels_objs', count: 6, radius: 0.265, halfWidth: 0.25 } },
  ingenuity: { url: '/models/ingenuity.glb', scale: 1, yawDeg: 0, stance: null, clearM: 1.2 },
  sev: {
    url: '/models/sev.glb',
    scale: 1,
    yawDeg: 180,
    stance: { width: 3.2, length: 3.6 },
    clearM: 5,
    // Measured on the model: six wheels of 0.5 m radius, their hubs 1.73 m either side of the middle.
    wheels: { radius: 0.5, halfWidth: 0.3, at: [-1.73, 1.73].flatMap((x) => [-1.305, 0.573, 2.045].map((z) => [x, 0.5, z] as const)) },
  },
  // Modelled in centimetres.
  habitat: { url: '/models/habitat.glb', scale: 0.04, yawDeg: 0, stance: null, clearM: 9.5 },
  z2: { url: '/models/z2.glb', scale: 1, yawDeg: 180, stance: null, clearM: 0.8 },
  // Drawn, not loaded. Wide things lean with the ground under their corners, as a vehicle on its wheels does.
  solar: { url: null, scale: 1, yawDeg: 0, stance: { width: 12.8, length: 8.6 }, clearM: 8.5 },
  pad: { url: null, scale: 1, yawDeg: 0, stance: { width: 16, length: 16 }, clearM: 10 },
  mast: { url: null, scale: 1, yawDeg: 0, stance: null, clearM: 1.2 },
  tunnel: { url: null, scale: 1, yawDeg: 0, stance: { width: 2.6, length: 9 }, clearM: 5 },
  station: { url: null, scale: 1, yawDeg: 0, stance: null, clearM: 23, footprint: STATION_FOOTPRINT },
};

/** Something that stands on the ground at a real place: a rover, the habitat, a parked vehicle. */
export interface PropSpec {
  id: string;
  model: ModelName;
  lon: number;
  lat: number;
  /** Compass heading its front faces, degrees clockwise from north. */
  headingDeg: number;
}
