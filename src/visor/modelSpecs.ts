export type ModelName = 'perseverance' | 'ingenuity' | 'sev' | 'habitat' | 'z2';

export interface ModelSpec {
  url: string;
  /** The file's units to metres. */
  scale: number;
  /** Turn about the vertical so the model's front faces north (-z) before any heading is applied. */
  yawDeg: number;
  /** Wheel track and wheelbase in metres for vehicles that rest on wheels; null for things that stand level. */
  stance: { width: number; length: number } | null;
  /** The radius it takes up on the ground, m: rocks and the viewer stay outside it. */
  clearM: number;
}

/** NASA 3D Resources models, optimised by tools/build_models.py. Sizes checked against the real hardware. */
export const MODELS: Record<ModelName, ModelSpec> = {
  perseverance: { url: '/models/perseverance.glb', scale: 1, yawDeg: 180, stance: { width: 2.4, length: 2.6 }, clearM: 3.2 },
  ingenuity: { url: '/models/ingenuity.glb', scale: 1, yawDeg: 0, stance: null, clearM: 1.2 },
  sev: { url: '/models/sev.glb', scale: 1, yawDeg: 180, stance: { width: 3.2, length: 3.6 }, clearM: 5 },
  // Modelled in centimetres.
  habitat: { url: '/models/habitat.glb', scale: 0.03, yawDeg: 0, stance: null, clearM: 8 },
  z2: { url: '/models/z2.glb', scale: 1, yawDeg: 180, stance: null, clearM: 0.8 },
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
