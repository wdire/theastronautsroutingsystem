import {
  Color,
  DirectionalLight,
  Mesh,
  PMREMGenerator,
  type Texture,
  FogExp2,
  HemisphereLight,
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Scenario, VehicleId } from '@/engines/types';
import { sunPosition } from '@/engines/marsTime';
import { tauAt, visibilityKm } from '@/engines/environment';
import { groundAt } from '@/data/dem';
import { bearingOf, toLocal, toLonLat, type Frame } from './frame';
import { buildPatch, CLOSE, FAR, HOLE_INSET_M, MID, NEAR, type Patch, type PatchSpec } from './patch';
import { fieldSlopeAt } from './heightfield';
import { groundQuality, loadGroundDetail } from './groundShader';
import { createSky } from './sky';
import { createRocks } from './rocks';
import { skyState } from './skyModel';
import { createProps, keepOutside } from './props';
import { createParty } from './party';
import { cyclesPerMetre } from './suit';
import { isPhone } from '@/lib/device';
import { createWalkers, type WalkerSpec } from './walkers';
import { prefetchAhead } from './prefetch';
import type { CrewLook } from './crewLook';
import { createGuides } from './guides';
import { releaseModels, retainModels } from './models';
import type { PropSpec } from './modelSpecs';

export type { PropSpec } from './modelSpecs';

export type Quality = 'auto' | 'high' | 'low';

export interface VisorOptions {
  lon: number;
  lat: number;
  headingDeg?: number;
  /** The app clock. */
  utcMs: () => number;
  scenario: () => Scenario;
  /** The rovers, base and vehicles standing in the scene. */
  props?: readonly PropSpec[];
  /** A running mission to ride along with. Absent: the viewer walks on their own. */
  mission?: MissionFeed;
  onState?: (state: VisorState) => void;
  /** Came from the map: start at the map camera's height and heading, then come down to eye level. */
  arrive?: { headingDeg: number; pitchDeg: number; liftM: number };
  /** The visitor zoomed out past the highest view: the caller goes back to the map. */
  onAscend?: () => void;
  /** Other people standing in Rover View, asked a few times a second. */
  walkers?: () => readonly WalkerSpec[];
  /** The browser took the graphics away and did not give them back: the caller should start the view again. */
  onLost?: () => void;
}

export type CameraMode = 'helmet' | 'chase' | 'orbit';
/** On your own: how far the camera stands from you or the vehicle you drive. */
export type RoamView = 'eyes' | 'close' | 'far';

/** What the view needs from a running mission, asked every frame. */
export interface MissionFeed {
  vehicle: VehicleId;
  /** Who walks, in file order; the visitor's own member carries the helmet camera. */
  roster: readonly CrewLook[];
  /** Where the crew is now; null once there is no mission. */
  crew(): { lon: number; lat: number; headingDeg: number; speedMs: number; moving: boolean } | null;
  /** The route from the crew on, nearest first, and the next objective. */
  ahead(): { path: readonly (readonly [number, number])[]; objective: readonly [number, number] | null };
  /** The clock is running at 5x or faster: draw less. */
  fast(): boolean;
  /**
   * How much the view may draw: 0 at 1x or paused (everything, sharpening as tiles arrive), 1 at 5x (no finest
   * layer, no post effects), 2 faster still (the coarse ground only: at that speed nothing finer can be seen).
   */
  tier?(): 0 | 1 | 2;
}

export interface VisorState {
  ready: boolean;
  /** What is being prepared, in words, or null when nothing is. */
  loading: string | null;
  lon: number;
  lat: number;
  elev: number;
  slopeDeg: number;
  headingDeg: number;
  pitchDeg: number;
  fps: number;
  /** The elevation data under the viewer, e.g. "HiRISE 1 m DTM". */
  groundSource: string;
  quality: 'high' | 'low';
  sunElevDeg: number;
  /** The id of the prop the viewer stands near, or null. */
  near: string | null;
  /** Which camera shows a mission; 'helmet' when there is none. */
  camera: CameraMode;
  /** On your own: what you move as (on foot, or a vehicle you drive) and where the camera stands. */
  roam: { vehicle: VehicleId; view: RoamView };
}

export interface VisorHandle {
  /** Walk input from an on-screen pad: -1..1 right and forward. */
  setMove(right: number, forward: number, fast?: boolean): void;
  look(dYawDeg: number, dPitchDeg: number): void;
  setQuality(q: Quality): void;
  /** Raises the eye above the ground on foot, m (0 is standing). */
  setLift(m: number): void;
  /** Shows or hides the drawn-in rocks. */
  setRocks(on: boolean): void;
  /** Which camera follows the mission. */
  setCamera(mode: CameraMode): void;
  /** On your own: walk, or take a vehicle and drive it; and the camera's distance. */
  setRoam(vehicle: VehicleId, view: RoamView): void;
  resize(): void;
  /** The resolution the scene is drawn at, as a share of CSS pixels (it adapts to the frame rate); for the checks. */
  ratio(): number;
  getState(): VisorState;
  /**
   * The eye this frame, cheap enough to read every frame: how far it looks down (degrees, positive down), the
   * camera's vertical field of view, the walk (cycles walked, and 0 standing to 1 walking), how fast the view
   * turns (radians a second), and whether the visitor walks in their own eyes, close to the ground.
   */
  view(): { lookDownDeg: number; fovDeg: number; walkPhase: number; walk: number; yawRate: number; ownEyes: boolean };
  /** Where each prop stands, in scene metres; for tests. */
  props(): { id: string; x: number; z: number; y: number; seated: boolean; real: boolean }[];
  /** The viewer’s place in scene metres (x east, z south). */
  position(): { x: number; y: number; z: number };
  /** How far the camera is above the drawn ground under it, m. Never negative. */
  eyeAboveGround(): number;
  /** The route ahead of a ride, lon and lat from the party on (empty on foot), for the minimap. */
  route(): readonly (readonly [number, number])[];
  /** What the last frame cost, for the performance checks. */
  stats(): { triangles: number; calls: number; rocks: number; layers: string; wheels: [number, number]; textures: number; geometries: number; programs: number; party: [number, number] | null };
  dispose(): void;
}

const EYE_M = 1.7;
/** Top speed when you drive or walk on your own, m/s (Shift for more): brisker than the real machines, to get about. */
const ROAM_TOP_MS: Record<VehicleId, number> = { foot: 1.6, openRover: 6, pressRover: 5, robotRover: 3, heli: 8 };
const WALK_MS = 1.6;
const FAST_MS = 9;
const MAX_LIFT_M = 150;

export function groundSourceName(zoom: number): string {
  if (zoom >= 18) return 'HiRISE 1 m DTM';
  if (zoom >= 14) return 'HiRISE DTM, read at 5 m';
  if (zoom >= 12) return 'CTX 20 m DTM';
  if (zoom >= 6) return 'HRSC and MOLA 200 m DEM';
  return 'MOLA 463 m DEM';
}

export class WebGLUnavailableError extends Error {
  constructor() {
    super('This browser could not start 3D graphics.');
    this.name = 'WebGLUnavailableError';
  }
}

/** Starts the helmet view on a canvas. Rejects with WebGLUnavailableError if the browser cannot draw it. */
export async function mountVisor(canvas: HTMLCanvasElement, options: VisorOptions): Promise<VisorHandle> {
  let renderer: WebGLRenderer;
  try {
    // Drawn straight to the screen. Ambient occlusion, SMAA and the half-float buffers they needed cost a third
    // of every frame and a few hundred megabytes of graphics memory, for a difference that could hardly be seen
    // on this ground. Multisampling the canvas cost as much again here (measured on Metal); drawn at 1.25 to
    // 1.5 times the CSS pixels, edges are already finer than the screen shows.
    renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch {
    throw new WebGLUnavailableError();
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.outputColorSpace = SRGBColorSpace;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new Scene();
  const fog = new FogExp2(new Color(0.8, 0.65, 0.5), 0.00003);
  scene.fog = fog;
  const camera = new PerspectiveCamera(62, 1, 0.5, 130_000);
  camera.rotation.order = 'YXZ';

  const hemi = new HemisphereLight(0xffffff, 0x8a6a4c, 1);
  const sun = new DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  const sc = sun.shadow.camera;
  sc.left = -90;
  sc.right = 90;
  sc.top = 90;
  sc.bottom = -90;
  sc.near = 1;
  sc.far = 900;
  sc.updateProjectionMatrix();
  scene.add(hemi, sun, sun.target);
  const sky = createSky();
  scene.add(sky.mesh);

  // The sky lights everything it can see: an environment map rendered from the dome, renewed as the sun moves.
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new Scene();
  envScene.add(new Mesh(sky.mesh.geometry, sky.mesh.material));
  let envMap: Texture | null = null;
  let envSun = new Vector3(0, -2, 0);
  const renewEnvironment = (sunDir: Vector3) => {
    if (envMap && sunDir.distanceTo(envSun) < 0.03) return;
    envSun = sunDir.clone();
    const next = pmrem.fromScene(envScene, 0, 0.1, 1000).texture;
    scene.environment = next;
    envMap?.dispose();
    envMap = next;
  };

  const base = await groundAt(options.lon, options.lat).catch(() => ({ elev: 0, slopeDeg: 0, zoom: 0 }));
  const frame: Frame = { lon0: options.lon, lat0: options.lat, base: base.elev };

  let disposed = false;
  let quality: Quality = 'auto';
  // A phone starts on the light setting (no fine ground shading, smaller shadows, fewer rocks): its graphics are a
  // fraction of a laptop's, and the first seconds there were a slide show before the view stepped down by itself.
  let effective: 'high' | 'low' = isPhone() ? 'low' : 'high';
  const state: VisorState = {
    ready: false,
    loading: 'Building the ground from orbital data…',
    lon: options.lon,
    lat: options.lat,
    elev: base.elev,
    slopeDeg: base.slopeDeg,
    headingDeg: options.headingDeg ?? 0,
    pitchDeg: 0,
    fps: 60,
    groundSource: groundSourceName(base.zoom),
    quality: 'high',
    sunElevDeg: 0,
    near: null,
    camera: options.mission ? 'chase' : 'helmet',
    roam: { vehicle: 'foot', view: 'eyes' },
  };

  /* ---- ground layers ---- */
  loadGroundDetail(maxAniso);
  type Layer = { patch: Patch | null; building: boolean; spec: PatchSpec; moveM: number; sharpening: boolean };
  const layers: Record<PatchSpec['kind'], Layer> = {
    far: { patch: null, building: false, spec: FAR, moveM: 25_000, sharpening: false },
    mid: { patch: null, building: false, spec: MID, moveM: 8_000, sharpening: false },
    near: { patch: null, building: false, spec: NEAR, moveM: 380, sharpening: false },
    close: { patch: null, building: false, spec: CLOSE, moveM: 56, sharpening: false },
  };
  const ORDER: PatchSpec['kind'][] = ['far', 'mid', 'near', 'close'];
  const INSET: Record<PatchSpec['kind'], number> = { far: 0, mid: HOLE_INSET_M.mid, near: HOLE_INSET_M.near, close: HOLE_INSET_M.close };

  const updateHoles = () => {
    // Each layer leaves a hole where the next finer one lies; the hole stops a little inside the finer
    // patch, so the two overlap rather than leave a crack.
    for (let i = 0; i < ORDER.length - 1; i += 1) {
      const coarse = layers[ORDER[i]!].patch;
      const kind = ORDER[i + 1]!;
      const fine = layers[kind].patch;
      coarse?.setHole(fine?.cx ?? 1e9, fine?.cz ?? 1e9, fine ? fine.spec.sizeM / 2 - INSET[kind] : 0);
    }
  };

  const swapIn = (layer: Layer, next: Patch) => {
    if (layer.patch) {
      scene.remove(layer.patch.mesh);
      layer.patch.dispose();
    }
    layer.patch = next;
    scene.add(next.mesh);
    updateHoles();
  };

  /**
   * Patches built and waiting to be shown. Their textures go to the graphics card one a frame (see the frame
   * loop), then the patch replaces the old one: sent all at once, a new layer's textures and triangles held up
   * a frame for a tenth of a second or more.
   */
  const staged: { textures: Texture[]; ready: () => void }[] = [];
  const show = async (layer: Layer, next: Patch, still: () => boolean = () => true): Promise<Patch | null> => {
    await new Promise<void>((ready) => staged.push({ textures: [...next.textures], ready }));
    if (disposed || !still()) {
      next.dispose();
      return null;
    }
    swapIn(layer, next);
    return next;
  };

  const ensure = (kind: PatchSpec['kind'], x: number, z: number) => {
    const layer = layers[kind];
    if (layer.building || disposed) return;
    const p = layer.patch;
    if (p && Math.hypot(p.cx - x, p.cz - z) < layer.moveM) return;
    // The close patch lies on the near one and blends into its surface: it waits for it.
    const coarser = kind === 'close' ? layers.near.patch : null;
    if (kind === 'close' && !coarser) return;
    // At 5x and faster the ground under the wheels streams past: rebuilding the finest layer every few
    // seconds only churns memory (a 25 cm image and a quarter of a million points each time).
    const tier = tierNow();
    if (kind === 'close' && tier >= 1) return;
    layer.building = true;
    // Where the ground is not yet drawn at all, the package is used first (fast); HiRISE follows. At the top
    // speeds the package is all: HiRISE would arrive after the ground had already streamed past.
    const quick = (!p || tier === 2) && layer.spec.hirise !== undefined;
    const cx = kind === 'close' ? Math.round(x / 8) * 8 : x;
    const cz = kind === 'close' ? Math.round(z / 8) * 8 : z;
    const options = { maxAnisotropy: maxAniso, hirise: !quick, coarser: coarser ? (px: number, pz: number) => coarser.heightAt(px, pz) : undefined };
    buildPatch(frame, cx, cz, layer.spec, options)
      .then((built) => show(layer, built))
      .then((next) => {
        if (!next) return;
        if (quick && tierNow() < 2) {
          sharpenTried.add(next);
          sharpen(kind, next);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        layer.building = false;
      });
  };

  /** Rebuilds a patch drawn from the package with HiRISE, in place, once its tiles have arrived. */
  const sharpen = (kind: PatchSpec['kind'], from: Patch) => {
    const layer = layers[kind];
    layer.sharpening = true;
    state.loading = state.ready ? 'Bringing in HiRISE detail…' : state.loading;
    const coarser = kind === 'close' ? layers.near.patch : null;
    buildPatch(frame, from.cx, from.cz, layer.spec, { maxAnisotropy: maxAniso, hirise: true, coarser: coarser ? (px, pz) => coarser.heightAt(px, pz) : undefined })
      // Moved on meanwhile: the newer patch is already HiRISE.
      .then((built) => show(layer, built, () => layer.patch === from))
      .then((next) => {
        if (!next) return;
        // The close patch blended into the old near surface; it is built again against the new one.
        if (kind === 'near' && layers.close.patch) rebuildClose = true;
      })
      .catch(() => undefined)
      .finally(() => {
        layer.sharpening = false;
        if (!Object.values(layers).some((l) => l.sharpening)) state.loading = null;
      });
  };
  let rebuildClose = false;

  const heightAt = (x: number, z: number): number =>
    layers.close.patch?.heightAt(x, z) ?? layers.near.patch?.heightAt(x, z) ?? layers.mid.patch?.heightAt(x, z) ?? layers.far.patch?.heightAt(x, z) ?? 0;

  retainModels();
  const nearHeight = (x: number, z: number) => layers.close.patch?.heightAt(x, z) ?? layers.near.patch?.heightAt(x, z) ?? null;
  const props = createProps(scene, frame, options.props ?? [], nearHeight);
  // Rocks stand on the near patch only: beyond it they would be smaller than a pixel.
  const rocks = createRocks(scene, nearHeight, (x, z) => {
    const p = layers.close.patch ?? layers.near.patch;
    return p ? fieldSlopeAt(p.field, x, z) : 0;
  }, props.clearings, (x, z) => (layers.close.patch ?? layers.near.patch)?.roughnessAt(x, z) ?? layers.near.patch?.roughnessAt(x, z) ?? null);
  let rocksPatch: Patch | null = null;
  const mission = options.mission;
  const party = mission ? createParty(scene, mission.vehicle, heightAt, mission.roster) : null;
  const tierNow = (): 0 | 1 | 2 => (mission ? (mission.tier?.() ?? (mission.fast() ? 1 : 0)) : 0);
  // Other people with Rover View open nearby, walking where they are.
  const walkers = options.walkers ? createWalkers(scene, frame, heightAt) : null;
  let lastWalkers = -1e9;
  const guides = mission ? createGuides(scene, heightAt) : null;
  let lastGuides = -1e9;
  let lastPrefetch = -1e9;
  let routeAhead: readonly (readonly [number, number])[] = [];
  let loweredForSpeed = false;
  let lastTier: 0 | 1 | 2 = 0;
  let lastSharpenCheck = 0;
  const sharpenTried = new WeakSet<Patch>();
  // The chase camera swings round behind the party at its own pace, so a turn does not whip the view.
  let chaseAngle = Number.NaN;
  let orbitAngle = 0;
  let eyeAbove = EYE_M;
  // On foot the wheel lifts the eye off the ground, up to a drone's height, and brings it back down.
  let lift = options.mission ? 0 : Math.max(0, Math.min(MAX_LIFT_M, options.arrive?.liftM ?? 0));
  // The descent from the map's camera, eased over a few seconds once the ground is built; any input ends it.
  let descent: { t: number; lift: number; pitch: number; free?: boolean } | null = options.arrive && !options.mission ? { t: 0, lift, pitch: (-options.arrive.pitchDeg * Math.PI) / 180 } : null;
  // On your own, anything but walking in your own eyes: a body or vehicle that moves, and a camera that follows.
  let roamParty: ReturnType<typeof createParty> | null = null;
  const roamer = { x: 0, z: 0, heading: 0, speed: 0 };
  let roamDist = 1;
  // Zooming out past the top is gathered like the map's push, so one notch too many does not leave.
  let ascendPush = 0;
  let ascendAt = 0;

  /* ---- viewer ---- */
  const pos = new Vector3(0, EYE_M, 0);
  const lastSound = pos.clone();
  // In a mission these are offsets from the camera's own direction; on foot they are the direction itself.
  let yaw = options.mission ? 0 : (((options.arrive?.headingDeg ?? options.headingDeg ?? 0) * Math.PI) / 180);
  // Positive pitch looks down (the camera turns by its negative); the arrival's pitch is the other way round.
  let pitch = options.mission ? 0 : options.arrive ? (-options.arrive.pitchDeg * Math.PI) / 180 : -0.06;
  let eyeY = EYE_M;
  const keys = new Set<string>();
  const pad = { right: 0, forward: 0, fast: false };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const k = 0.0032 * (camera.fov / 62);
    yaw -= (e.clientX - lastX) * k * -1;
    pitch += (e.clientY - lastY) * k;
    pitch = Math.max(-1.25, Math.min(1.25, pitch));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  const onWheel = (e: WheelEvent) => {
    if (mission) return;
    e.preventDefault();
    // During the arrival the eye is still coming down: the wheel waits for it to land.
    if (descent) {
      descent.free = true;
      return;
    }
    if (roamParty && state.roam.view !== 'eyes') {
      roamDist = Math.max(0.5, Math.min(6, roamDist * Math.exp(e.deltaY * 0.0016)));
      return;
    }
    if (e.deltaY > 0 && lift >= MAX_LIFT_M - 0.5 && options.onAscend) {
      const now = performance.now();
      if (now - ascendAt > 700) ascendPush = 0;
      ascendAt = now;
      ascendPush += Math.abs(e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
      if (ascendPush > 320) options.onAscend();
      return;
    }
    // Proportional steps: a notch is a few centimetres near the ground and metres high up.
    lift = Math.max(0, Math.min(MAX_LIFT_M, (lift + 0.6) * Math.exp(e.deltaY * -0.0022) - 0.6));
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /**
   * The resolution the scene is drawn at, as a share of CSS pixels. Up to 1.5 on a high-density screen (the
   * difference from 2 is hard to see, and 2 is 78% more pixels), lowered a step at a time while frames run
   * long and raised again after a long stretch at full rate: a full-screen view on a laptop's graphics is
   * limited by how many pixels it shades, and a steady 60 frames reads better than a few more pixels.
   */
  const maxRatio = Math.min(window.devicePixelRatio || 1, isPhone() ? 1.25 : 1.5);
  const minRatio = Math.min(1, maxRatio);
  let pixelRatio = maxRatio > 1.25 ? 1.25 : maxRatio;
  const ratioWatch = { since: performance.now(), frames: 0, slow: 0, slowWindows: 0, goodSince: performance.now(), raisedAt: -1e9, raiseBlocked: false };
  const adaptResolution = (now: number, dt: number) => {
    if (effective === 'low') return;
    ratioWatch.frames += 1;
    if (dt > 0.0205) ratioWatch.slow += 1;
    const span = now - ratioWatch.since;
    if (span < 2000) return;
    const slowShare = ratioWatch.slow / Math.max(1, ratioWatch.frames);
    ratioWatch.since = now;
    ratioWatch.frames = 0;
    ratioWatch.slow = 0;
    // Every change reallocates the drawing buffer, a hitch of its own: two slow stretches in a row before going
    // down, twenty seconds of full rate before trying a step up, and no more tries once one has not held.
    ratioWatch.slowWindows = slowShare > 0.3 ? ratioWatch.slowWindows + 1 : 0;
    if (slowShare > 0.03) ratioWatch.goodSince = now;
    let next = pixelRatio;
    if (ratioWatch.slowWindows >= 2 && pixelRatio > minRatio) {
      next = Math.max(minRatio, pixelRatio - 0.125);
      ratioWatch.slowWindows = 0;
      if (now - ratioWatch.raisedAt < 8000) ratioWatch.raiseBlocked = true;
    } else if (!ratioWatch.raiseBlocked && pixelRatio < maxRatio && now - ratioWatch.goodSince > 20_000) {
      next = Math.min(maxRatio, pixelRatio + 0.125);
      ratioWatch.raisedAt = now;
      ratioWatch.goodSince = now;
    }
    if (next !== pixelRatio) {
      pixelRatio = next;
      renderer.setPixelRatio(pixelRatio);
      resize();
    }
  };

  const applyQuality = () => {
    const low = effective === 'low';
    // 1.5 at most: on a Retina screen the difference from 2 is hard to see, and it is 44% fewer pixels for
    // ambient occlusion and antialiasing to work through every frame.
    renderer.setPixelRatio(low ? 1 : pixelRatio);
    groundQuality.value = low ? 0 : 1;
    rocks.setLowQuality(low);
    sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    state.quality = effective;
  };

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // A phone held upright needs a wider lens to feel the same.
    camera.fov = camera.aspect < 1 ? 78 : 62;
    camera.updateProjectionMatrix();
  };
  applyQuality();
  resize();
  window.addEventListener('resize', resize);

  /* ---- light ---- */
  const sunDir = new Vector3(0, 1, 0);
  let lastLight = -1e9;
  const updateLight = (now: number) => {
    if (now - lastLight < 500) return;
    lastLight = now;
    const utc = options.utcMs();
    const [lon, lat] = toLonLat(frame, pos.x, pos.z);
    const s = sunPosition(utc, lat, lon);
    const tau = tauAt(lat, lon, utc, options.scenario());
    const sk = skyState(s.elevDeg, tau, visibilityKm(tau));
    const el = (Math.max(s.elevDeg, 2) * Math.PI) / 180;
    const az = (s.azDeg * Math.PI) / 180;
    // Azimuth is clockwise from north; north is -z, east is +x.
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const trueEl = (s.elevDeg * Math.PI) / 180;
    const skySun = new Vector3(Math.sin(az) * Math.cos(trueEl), Math.sin(trueEl), -Math.cos(az) * Math.cos(trueEl)).normalize();
    sky.update(sk, skySun);
    renewEnvironment(skySun);
    sun.color.setRGB(...sk.sun);
    sun.intensity = sk.sunIntensity * 1.5;
    sun.castShadow = sk.sunIntensity > 0.15;
    // Most of the fill comes from the sky's environment map; the hemisphere adds the ground's bounce.
    // Kept low: Mars's thin dusty sky fills shadows less than Earth's, and too much fill flattens the relief.
    hemi.intensity = sk.ambient * 0.16;
    scene.environmentIntensity = sk.ambient * 0.32;
    hemi.color.setRGB(sk.zenith[0] * 0.6 + 0.4, sk.zenith[1] * 0.6 + 0.38, sk.zenith[2] * 0.6 + 0.36);
    hemi.groundColor.setRGB(0.5, 0.38, 0.27);
    fog.color.setRGB(...sk.fog);
    // The dust haze, a little thinner than the visibility model alone: distant relief should still read.
    fog.density = sk.fogDensity * 0.6;
    state.sunElevDeg = s.elevDeg;
  };

  /* ---- loop ---- */
  let last = performance.now();
  let fpsSmooth = 60;
  let slowSince = 0;
  let lastReport = 0;
  /** What the eye is doing this frame, for the overlays that move with it (the tablet in hand). */
  const eye = { lookDown: 0, yaw: 0, yawRate: 0, walkPhase: 0, walk: 0, stepMs: 0 };
  let raf = 0;

  const frameLoop = (now: number) => {
    raf = requestAnimationFrame(frameLoop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (dt > 0) fpsSmooth += (1 / dt - fpsSmooth) * 0.05;
    if (state.ready && quality !== 'low') adaptResolution(now, dt);

    if (descent && state.ready) {
      // A key or a drag takes the look from the descent, but the eye still comes down to the ground: before,
      // any input froze it where it was, and a visitor who looked around early was left hanging 100 m up.
      if (keys.size > 0 || dragging) descent.free = true;
      descent.t = Math.min(1, descent.t + dt / 3.2);
      const k = descent.t < 0.5 ? 4 * descent.t ** 3 : 1 - (-2 * descent.t + 2) ** 3 / 2;
      lift = descent.lift * (1 - k);
      if (!descent.free) pitch = descent.pitch + (-0.06 - descent.pitch) * k;
      if (descent.t >= 1) descent = null;
    }
    let viewYaw = yaw;
    let viewPitch = pitch;
    const crew = mission && party ? mission.crew() : null;
    if (crew && party) {
      // Riding along: the party follows the simulation and the camera follows the party.
      const [tx, tz] = toLocal(frame, crew.lon, crew.lat);
      party.update({ x: tx, z: tz, headingDeg: crew.headingDeg, speedMs: crew.speedMs, moving: crew.moving }, dt);
      const f = party.focus();
      party.setFirstPerson(state.camera === 'helmet');
      if (state.camera === 'helmet') {
        // Through the eyes of the last in file: the leader walks ahead in view.
        pos.x = f.rear.x;
        pos.z = f.rear.z;
        viewYaw = f.rear.heading + yaw;
        eyeAbove = party.eyeM;
      } else {
        const behind = f.heading + Math.PI;
        if (Number.isNaN(chaseAngle)) chaseAngle = behind;
        let d = (behind - chaseAngle) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        chaseAngle += d * Math.min(1, dt * 1.6);
        orbitAngle += dt * 0.12;
        const orbit = state.camera === 'orbit';
        const away = (orbit ? orbitAngle : chaseAngle) + yaw;
        const dist = party.sizeM * (orbit ? 1.25 : 0.95) + (orbit ? 3.5 : 2.5);
        pos.x = f.x + Math.sin(away) * dist;
        pos.z = f.z - Math.cos(away) * dist;
        eyeAbove = orbit ? 3.2 : 2.4;
        // Look at the party's shoulders from wherever the camera has ended up.
        viewYaw = away + Math.PI;
        viewPitch = Math.atan2(eyeY - (f.y + 1.3), dist) + pitch;
      }
      if (guides && mission && now - lastGuides > 350) {
        lastGuides = now;
        const ahead = mission.ahead();
        routeAhead = ahead.path;
        // The ground the route is heading for starts loading now, so it is sharp by the time it is reached.
        if (now - lastPrefetch > 1500) {
          lastPrefetch = now;
          prefetchAhead(ahead.path, tierNow() >= 1, tierNow() === 2);
        }
        const objective = ahead.objective ? toLocal(frame, ahead.objective[0], ahead.objective[1]) : null;
        guides.update(
          ahead.path.map((p) => {
            const [x, z] = toLocal(frame, p[0], p[1]);
            return { x, z };
          }),
          objective ? { x: objective[0], z: objective[1] } : null,
        );
      }
    } else if (roamParty) {
      // Driving (or walking as a figure seen from outside): W and S speed up and slow down, A and D steer.
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + pad.forward;
      const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + pad.right;
      const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.fast;
      const top = ROAM_TOP_MS[state.roam.vehicle] * (fast ? 2.4 : 1);
      const want = Math.max(-0.4, Math.min(1, fwd)) * top;
      roamer.speed += (want - roamer.speed) * Math.min(1, dt * (Math.abs(want) > Math.abs(roamer.speed) ? 1.8 : 3.2));
      // A walker turns on the spot; a vehicle turns only while it rolls.
      const turnRate = state.roam.vehicle === 'foot' || state.roam.vehicle === 'heli' ? 1.9 : 1.1 * Math.min(1, Math.abs(roamer.speed) / 1.5) * Math.sign(roamer.speed || 1);
      roamer.heading += steer * turnRate * dt;
      const nx = roamer.x + Math.sin(roamer.heading) * roamer.speed * dt;
      const nz = roamer.z - Math.cos(roamer.heading) * roamer.speed * dt;
      [roamer.x, roamer.z] = keepOutside(nx, nz, props.clearings, roamParty.sizeM * 0.35);
      roamParty.update({ x: roamer.x, z: roamer.z, headingDeg: (roamer.heading * 180) / Math.PI, speedMs: Math.abs(roamer.speed), moving: Math.abs(roamer.speed) > 0.05 }, dt);
      const f = roamParty.focus();
      const view = state.roam.view;
      roamParty.setFirstPerson(view === 'eyes');
      if (view === 'eyes') {
        pos.x = f.x;
        pos.z = f.z;
        viewYaw = roamer.heading + yaw;
        eyeAbove = roamParty.eyeM + (state.roam.vehicle === 'heli' ? 6 : 0);
      } else {
        const dist = (roamParty.sizeM * (view === 'far' ? 2.6 : 1.1) + (view === 'far' ? 9 : 3)) * roamDist;
        const behind = roamer.heading + Math.PI + yaw;
        pos.x = f.x + Math.sin(behind) * dist;
        pos.z = f.z - Math.cos(behind) * dist;
        eyeAbove = (view === 'far' ? 7 : 2.6) * Math.sqrt(roamDist) + (state.roam.vehicle === 'heli' ? 6 : 0);
        viewYaw = behind + Math.PI;
        viewPitch = Math.atan2(eyeY - (f.y + 1.2), dist) + pitch;
      }
    } else {
      // Walk: keys or the on-screen pad, along the way the viewer faces.
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + pad.forward;
      const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + pad.right;
      const len = Math.hypot(fwd, right);
      if (len > 0.01) {
        // High up the ground slides by slowly: the pace grows with the height.
        const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.fast ? FAST_MS : WALK_MS) * Math.min(1, len) * (1 + lift / 6);
        eye.stepMs = lift < 0.5 ? speed : 0;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        // Facing direction for yaw 0 is north (-z); positive yaw turns toward the east.
        const nx = pos.x + ((fwd * sin + right * cos) / len) * speed * dt;
        const nz = pos.z + ((-fwd * cos + right * sin) / len) * speed * dt;
        // Nobody walks through a rover: a step into one ends at its side.
        [pos.x, pos.z] = keepOutside(nx, nz, props.clearings, 0.75);
      }
      if (len <= 0.01) eye.stepMs = 0;
      eyeAbove = EYE_M + lift;
    }

    if (rebuildClose && !layers.close.building && !layers.close.sharpening && layers.close.patch) {
      rebuildClose = false;
      sharpen('close', layers.close.patch);
    }
    for (const kind of ORDER) ensure(kind, pos.x, pos.z);
    // One texture of a waiting patch to the graphics card a frame; a patch whose textures are all there is shown.
    const waiting = staged[0];
    if (waiting) {
      const texture = waiting.textures.shift();
      if (texture) renderer.initTexture(texture);
      else {
        staged.shift();
        waiting.ready();
      }
    }

    // Stand on the drawn ground, and ease the eye height so steps in the data do not jolt the view.
    const ground = heightAt(pos.x, pos.z);
    const target = ground + eyeAbove;
    eyeY += (target - eyeY) * Math.min(1, dt * 10);
    // Never under the ground, whichever camera it is.
    if (eyeY < ground + 0.6) eyeY = ground + 0.6;
    pos.y = eyeY;
    // One bad number (a height read off the edge of every layer, a zero-length step) would leave the camera
    // nowhere and the screen black for good: fall back to the last place that was sound.
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      pos.copy(lastSound);
      eyeY = pos.y;
    } else {
      lastSound.copy(pos);
    }
    camera.position.copy(pos);
    camera.rotation.set(-Math.max(-1.3, Math.min(1.3, viewPitch)), -viewYaw, 0);
    if (dt > 0) {
      const turn = viewYaw - eye.yaw;
      eye.yawRate += ((Math.abs(turn) < 1 ? turn / dt : 0) - eye.yawRate) * Math.min(1, dt * 8);
    }
    eye.yaw = viewYaw;
    eye.lookDown = Math.max(-1.3, Math.min(1.3, viewPitch));
    eye.walk += ((eye.stepMs > 0.05 ? 1 : 0) - eye.walk) * Math.min(1, dt * 4);
    eye.walkPhase += eye.stepMs * dt * cyclesPerMetre(eye.stepMs);
    sky.mesh.position.copy(pos);
    sky.mesh.scale.setScalar(100_000);

    // A new near patch means new ground under every rock.
    const groundChanged = rocksPatch !== (layers.close.patch ?? layers.near.patch);
    rocks.update(pos.x, pos.z, groundChanged);
    props.update(pos.x, pos.z, groundChanged);
    rocksPatch = layers.close.patch ?? layers.near.patch;

    if (walkers && options.walkers) {
      if (now - lastWalkers > 250) {
        lastWalkers = now;
        walkers.set(options.walkers());
      }
      walkers.update(dt);
    }
    updateLight(now);
    // The shadow box follows the viewer, moved in whole texels so shadows do not swim.
    const texel = 180 / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(pos.x / texel) * texel, ground, Math.round(pos.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);

    renderer.render(scene, camera);

    if (!state.ready && layers.near.patch && layers.mid.patch) {
      state.ready = true;
      state.loading = Object.values(layers).some((l) => l.sharpening) ? 'Bringing in HiRISE detail…' : null;
      eyeY = heightAt(pos.x, pos.z) + eyeAbove;
    }
    if (state.ready && mission) {
      const tier = tierNow();
      // The fastest tier draws no rocks and no close layer at all; dropping back brings both, and the ground
      // drawn from the package in the meantime is sharpened with HiRISE.
      if (tier !== lastTier) {
        rocks.setVisible(tier < 2);
        // The close layer goes altogether (its hole in the near layer with it); it is built again on slowing down.
        const close = layers.close.patch;
        if (tier === 2 && close && !layers.close.building) {
          scene.remove(close.mesh);
          close.dispose();
          layers.close.patch = null;
          updateHoles();
        }
        lastTier = tier;
      }
      if (tier === 0 && now - lastSharpenCheck > 1000) {
        lastSharpenCheck = now;
        for (const kind of ['near', 'close'] as const) {
          const l = layers[kind];
          // Each patch drawn from the package is offered HiRISE once; off the mosaics it stays as it is.
          if (l.patch && !l.patch.hirise && l.spec.hirise && !l.building && !l.sharpening && !sharpenTried.has(l.patch)) {
            sharpenTried.add(l.patch);
            sharpen(kind, l.patch);
          }
        }
      }
    }
    if (quality === 'auto' && state.ready && mission) {
      const fast = tierNow() >= 1;
      if (fast && effective === 'high') {
        // At 5x and faster the ground streams past: detail nobody can see is not drawn.
        effective = 'low';
        loweredForSpeed = true;
        applyQuality();
      } else if (!fast && loweredForSpeed) {
        // Back at walking pace the detail returns; a slow machine drops it again by frame rate.
        loweredForSpeed = false;
        slowSince = 0;
        effective = 'high';
        applyQuality();
      }
    }
    if (quality === 'auto' && state.ready) {
      if (fpsSmooth < 24 && effective === 'high') {
        slowSince ||= now;
        if (now - slowSince > 3000) {
          effective = 'low';
          applyQuality();
        }
      } else {
        slowSince = 0;
      }
    }
    if (now - lastReport > 200) {
      lastReport = now;
      const [lon, lat] = toLonLat(frame, pos.x, pos.z);
      state.lon = lon;
      state.lat = lat;
      state.elev = ground + frame.base;
      const near = layers.close.patch ?? layers.near.patch;
      state.slopeDeg = near ? fieldSlopeAt(near.field, pos.x, pos.z) : 0;
      state.headingDeg = bearingOf(Math.sin(viewYaw), -Math.cos(viewYaw));
      state.pitchDeg = (-viewPitch * 180) / Math.PI;
      state.fps = Math.round(fpsSmooth);
      if (near) state.groundSource = groundSourceName(near.demSourceZoom);
      state.near = props.nearest(pos.x, pos.z, 60);
      options.onState?.({ ...state });
    }
  };
  raf = requestAnimationFrame(frameLoop);

  let lostTimer = 0;
  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    state.loading = 'The graphics were interrupted. Restoring the view…';
    options.onState?.({ ...state });
    // Most browsers hand the context back within a second; when one does not, the view is built anew.
    lostTimer = window.setTimeout(() => options.onLost?.(), 1800);
  };
  // The ground's textures let go of their pixels once uploaded, so a context handed back cannot be refilled
  // from them: the view is built again, from tiles still in memory.
  const onRestored = () => {
    window.clearTimeout(lostTimer);
    options.onLost?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    setMove(right, forward, fast = false) {
      pad.right = right;
      pad.forward = forward;
      pad.fast = fast;
    },
    look(dYawDeg, dPitchDeg) {
      yaw += (dYawDeg * Math.PI) / 180;
      pitch = Math.max(-1.25, Math.min(1.25, pitch - (dPitchDeg * Math.PI) / 180));
    },
    setQuality(q) {
      quality = q;
      if (q !== 'auto') {
        effective = q;
        applyQuality();
      }
    },
    setLift(m) {
      lift = Math.max(0, Math.min(MAX_LIFT_M, m));
    },
    setRocks(on) {
      rocks.setVisible(on);
    },
    setRoam(vehicle, view) {
      if (mission) return;
      // Taking a vehicle (or a camera) lands the eye at once.
      if (descent) {
        descent = null;
        lift = 0;
      }
      const was = state.roam;
      state.roam = { vehicle, view };
      const needParty = vehicle !== 'foot' || view !== 'eyes';
      if (roamParty && (!needParty || was.vehicle !== vehicle)) {
        // Getting out: stand where the vehicle was, facing the way it faced.
        pos.x = roamer.x;
        pos.z = roamer.z;
        yaw = roamer.heading;
        roamParty.dispose();
        roamParty = null;
      }
      if (needParty && !roamParty) {
        roamer.x = pos.x;
        roamer.z = pos.z;
        roamer.heading = yaw;
        roamer.speed = 0;
        roamParty = createParty(scene, vehicle, heightAt, vehicle === 'foot' ? [{ id: 'me', name: 'You', role: 'Commander', color: '#e8743b', android: false, me: true }] : []);
        yaw = 0;
      }
      if (needParty) {
        lift = 0;
        pitch = view === 'eyes' ? -0.06 : 0;
        if (view !== was.view) roamDist = 1;
      }
    },
    setCamera(mode) {
      state.camera = mode;
      // The drag offset belongs to the camera it was made on.
      yaw = 0;
      pitch = mode === 'helmet' ? -0.06 : 0;
    },
    resize,
    // For the checks: the resolution the scene is drawn at now.
    ratio: () => pixelRatio,
    getState: () => ({ ...state }),
    view: () => ({
      lookDownDeg: (eye.lookDown * 180) / Math.PI,
      fovDeg: camera.fov,
      walkPhase: eye.walkPhase,
      walk: eye.walk,
      yawRate: eye.yawRate,
      ownEyes: !mission && !roamParty && lift < 1.5 && !descent,
    }),
    props: () => props.list(),
    route: () => routeAhead,
    position: () => ({ x: pos.x, y: pos.y, z: pos.z }),
    eyeAboveGround: () => pos.y - heightAt(pos.x, pos.z),
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, rocks: rocks.count(), wheels: party ? [party.wheelCount(), Math.round(party.wheelTurn() * 100) / 100] : [0, 0], layers: ORDER.map((k) => `${k}:${layers[k].patch ? (layers[k].patch.hirise ? `hirise ${layers[k].patch.debug}` : 'package') : 'none'}`).join(' '), textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length ?? 0, party: party ? [party.focus().x, party.focus().z] : null }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const waiting of staged.splice(0)) waiting.ready();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const layer of Object.values(layers)) layer.patch?.dispose();
      rocks.dispose();
      props.dispose();
      party?.dispose();
      walkers?.dispose();
      roamParty?.dispose();
      guides?.dispose();
      releaseModels();
      sky.dispose();
      envMap?.dispose();
      pmrem.dispose();
      window.clearTimeout(lostTimer);
      renderer.dispose();
      // Release the context now rather than when the page forgets the canvas: browsers keep only about
      // sixteen, and opening Rover View a few times would otherwise take the map's own context away.
      renderer.forceContextLoss();
    },
  };
}
