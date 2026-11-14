import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Scenario } from '@/engines/types';
import { sunPosition } from '@/engines/marsTime';
import { tauAt, visibilityKm } from '@/engines/environment';
import { groundAt } from '@/data/dem';
import { bearingOf, toLonLat, type Frame } from './frame';
import { buildPatch, FAR, HOLE_INSET_M, MID, NEAR, type Patch, type PatchSpec } from './patch';
import { fieldSlopeAt } from './heightfield';
import { groundQuality } from './groundShader';
import { createSky } from './sky';
import { createRocks } from './rocks';
import { skyState } from './skyModel';
import { createProps, keepOutside } from './props';
import { disposeModels } from './models';
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
  onState?: (state: VisorState) => void;
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
}

export interface VisorHandle {
  /** Walk input from an on-screen pad: -1..1 right and forward. */
  setMove(right: number, forward: number, fast?: boolean): void;
  look(dYawDeg: number, dPitchDeg: number): void;
  setQuality(q: Quality): void;
  resize(): void;
  getState(): VisorState;
  /** Where each prop stands, in scene metres; for tests. */
  props(): { id: string; x: number; z: number; y: number; seated: boolean; real: boolean }[];
  /** The viewer’s place in scene metres (x east, z south). */
  position(): { x: number; y: number; z: number };
  /** What the last frame cost, for the performance checks. */
  stats(): { triangles: number; calls: number; rocks: number };
  dispose(): void;
}

const EYE_M = 1.7;
const WALK_MS = 1.6;
const FAST_MS = 9;

export function groundSourceName(zoom: number): string {
  if (zoom >= 14) return 'HiRISE 1 m DTM';
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
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    throw new WebGLUnavailableError();
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
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

  const base = await groundAt(options.lon, options.lat).catch(() => ({ elev: 0, slopeDeg: 0, zoom: 0 }));
  const frame: Frame = { lon0: options.lon, lat0: options.lat, base: base.elev };

  let disposed = false;
  let quality: Quality = 'auto';
  let effective: 'high' | 'low' = 'high';
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
  };

  /* ---- ground layers ---- */
  const layers: Record<PatchSpec['kind'], { patch: Patch | null; building: boolean; spec: PatchSpec; moveM: number }> = {
    far: { patch: null, building: false, spec: FAR, moveM: 25_000 },
    mid: { patch: null, building: false, spec: MID, moveM: 8_000 },
    near: { patch: null, building: false, spec: NEAR, moveM: 380 },
  };

  const updateHoles = () => {
    const { far, mid, near } = layers;
    // The hole stops a little inside the finer patch, so the two overlap rather than leave a crack.
    if (far.patch) far.patch.setHole(mid.patch?.cx ?? 1e9, mid.patch?.cz ?? 1e9, mid.patch ? MID.sizeM / 2 - HOLE_INSET_M.mid : 0);
    if (mid.patch) mid.patch.setHole(near.patch?.cx ?? 1e9, near.patch?.cz ?? 1e9, near.patch ? NEAR.sizeM / 2 - HOLE_INSET_M.near : 0);
  };

  const ensure = (kind: PatchSpec['kind'], x: number, z: number) => {
    const layer = layers[kind];
    if (layer.building || disposed) return;
    const p = layer.patch;
    if (p && Math.hypot(p.cx - x, p.cz - z) < layer.moveM) return;
    layer.building = true;
    buildPatch(frame, x, z, layer.spec, maxAniso)
      .then((next) => {
        if (disposed) return next.dispose();
        if (layer.patch) {
          scene.remove(layer.patch.mesh);
          layer.patch.dispose();
        }
        layer.patch = next;
        scene.add(next.mesh);
        updateHoles();
      })
      .catch(() => undefined)
      .finally(() => {
        layer.building = false;
      });
  };

  const heightAt = (x: number, z: number): number => layers.near.patch?.heightAt(x, z) ?? layers.mid.patch?.heightAt(x, z) ?? layers.far.patch?.heightAt(x, z) ?? 0;

  const nearHeight = (x: number, z: number) => layers.near.patch?.heightAt(x, z) ?? null;
  const props = createProps(scene, frame, options.props ?? [], nearHeight);
  // Rocks stand on the near patch only: beyond it they would be smaller than a pixel.
  const rocks = createRocks(scene, nearHeight, (x, z) => (layers.near.patch ? fieldSlopeAt(layers.near.patch.field, x, z) : 0), props.clearings);
  let rocksPatch: Patch | null = null;

  /* ---- viewer ---- */
  const pos = new Vector3(0, EYE_M, 0);
  let yaw = ((options.headingDeg ?? 0) * Math.PI) / 180;
  let pitch = -0.06;
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

  const applyQuality = () => {
    const low = effective === 'low';
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
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
    sky.update(sk, new Vector3(Math.sin(az) * Math.cos(trueEl), Math.sin(trueEl), -Math.cos(az) * Math.cos(trueEl)).normalize());
    sun.color.setRGB(...sk.sun);
    sun.intensity = sk.sunIntensity;
    sun.castShadow = sk.sunIntensity > 0.15;
    hemi.intensity = sk.ambient;
    hemi.color.setRGB(sk.zenith[0] * 0.6 + 0.4, sk.zenith[1] * 0.6 + 0.38, sk.zenith[2] * 0.6 + 0.36);
    hemi.groundColor.setRGB(0.5, 0.38, 0.27);
    fog.color.setRGB(...sk.fog);
    fog.density = sk.fogDensity;
    state.sunElevDeg = s.elevDeg;
  };

  /* ---- loop ---- */
  let last = performance.now();
  let fpsSmooth = 60;
  let slowSince = 0;
  let lastReport = 0;
  let raf = 0;

  const frameLoop = (now: number) => {
    raf = requestAnimationFrame(frameLoop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (dt > 0) fpsSmooth += (1 / dt - fpsSmooth) * 0.05;

    // Walk: keys or the on-screen pad, along the way the viewer faces.
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + pad.forward;
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + pad.right;
    const len = Math.hypot(fwd, right);
    if (len > 0.01) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.fast ? FAST_MS : WALK_MS) * Math.min(1, len);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Facing direction for yaw 0 is north (-z); positive yaw turns toward the east.
      const nx = pos.x + ((fwd * sin + right * cos) / len) * speed * dt;
      const nz = pos.z + ((-fwd * cos + right * sin) / len) * speed * dt;
      // Nobody walks through a rover: a step into one ends at its side.
      [pos.x, pos.z] = keepOutside(nx, nz, props.clearings, 0.75);
    }

    ensure('far', pos.x, pos.z);
    ensure('mid', pos.x, pos.z);
    ensure('near', pos.x, pos.z);

    // Stand on the drawn ground, and ease the eye height so steps in the data do not jolt the view.
    const ground = heightAt(pos.x, pos.z);
    const target = ground + EYE_M;
    eyeY += (target - eyeY) * Math.min(1, dt * 10);
    if (eyeY < ground + 0.6) eyeY = ground + 0.6;
    pos.y = eyeY;
    camera.position.copy(pos);
    camera.rotation.set(-pitch, -yaw, 0);
    sky.mesh.position.copy(pos);
    sky.mesh.scale.setScalar(100_000);

    // A new near patch means new ground under every rock.
    const groundChanged = rocksPatch !== layers.near.patch;
    rocks.update(pos.x, pos.z, groundChanged);
    props.update(pos.x, pos.z, groundChanged);
    rocksPatch = layers.near.patch;

    updateLight(now);
    // The shadow box follows the viewer, moved in whole texels so shadows do not swim.
    const texel = 180 / sun.shadow.mapSize.x;
    sun.target.position.set(Math.round(pos.x / texel) * texel, ground, Math.round(pos.z / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 400);

    renderer.render(scene, camera);

    if (!state.ready && layers.near.patch && layers.mid.patch) {
      state.ready = true;
      state.loading = null;
      eyeY = heightAt(pos.x, pos.z) + EYE_M;
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
      const near = layers.near.patch;
      state.slopeDeg = near ? fieldSlopeAt(near.field, pos.x, pos.z) : 0;
      state.headingDeg = bearingOf(Math.sin(yaw), -Math.cos(yaw));
      state.pitchDeg = (-pitch * 180) / Math.PI;
      state.fps = Math.round(fpsSmooth);
      if (near) state.groundSource = groundSourceName(near.demSourceZoom);
      state.near = props.nearest(pos.x, pos.z, 60);
      options.onState?.({ ...state });
    }
  };
  raf = requestAnimationFrame(frameLoop);

  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    state.loading = 'The graphics were interrupted. Restoring the view…';
    options.onState?.({ ...state });
  };
  const onRestored = () => {
    last = performance.now();
    state.loading = null;
    raf = requestAnimationFrame(frameLoop);
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
    resize,
    getState: () => ({ ...state }),
    props: () => props.list(),
    position: () => ({ x: pos.x, y: pos.y, z: pos.z }),
    stats: () => ({ triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, rocks: rocks.count() }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const layer of Object.values(layers)) layer.patch?.dispose();
      rocks.dispose();
      props.dispose();
      disposeModels();
      sky.dispose();
      renderer.dispose();
    },
  };
}
