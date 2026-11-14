import { Group, type Mesh, type Object3D, type Scene } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { toLocal, type Frame } from './frame';
import { disposeObject, loadModel, standIn } from './models';
import { MODELS, type PropSpec } from './modelSpecs';
import { rigSuit, type Suit } from './suit';

export interface Seat {
  y: number;
  pitch: number;
  roll: number;
}

/**
 * How a vehicle rests on uneven ground: tilted to the ground under its four wheels and lifted until
 * the wheel that stands highest touches, so none is sunk into a slope. `heights` are the ground under
 * the front-left, front-right, rear-left and rear-right wheels.
 */
export function seatOnWheels(heights: readonly [number, number, number, number], width: number, length: number): Seat {
  const [fl, fr, rl, rr] = heights;
  const mean = (fl + fr + rl + rr) / 4;
  const dPitch = (fl + fr) / 2 - (rl + rr) / 2;
  const dRoll = (fr + rr) / 2 - (fl + rl) / 2;
  // What is left of each wheel's ground after the tilted plane is taken out.
  const twist = Math.max(fl - (mean + dPitch / 2 - dRoll / 2), fr - (mean + dPitch / 2 + dRoll / 2), rl - (mean - dPitch / 2 - dRoll / 2), rr - (mean - dPitch / 2 + dRoll / 2));
  return { y: mean + Math.max(0, twist), pitch: Math.atan2(dPitch, length), roll: Math.atan2(dRoll, width) };
}

/** A disc on the ground that something stands in. */
export interface Clearing {
  x: number;
  z: number;
  r: number;
}

/**
 * Moves a point out of any clearing it has walked into, to the nearest point on its edge. `slack`
 * scales the discs: a walker may come closer to a rover than a rock may lie.
 */
export function keepOutside(x: number, z: number, clearings: readonly Clearing[], slack = 1): [x: number, z: number] {
  let px = x;
  let pz = z;
  for (const c of clearings) {
    const r = c.r * slack;
    const dx = px - c.x;
    const dz = pz - c.z;
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    // Dead centre has no direction to leave by; step out to the east.
    px = d > 1e-6 ? c.x + (dx / d) * r : c.x + r;
    pz = d > 1e-6 ? c.z + (dz / d) * r : c.z;
  }
  return [px, pz];
}

interface Item {
  spec: PropSpec;
  x: number;
  z: number;
  anchor: Group;
  /** The stand-in, then the real model; null until the viewer first comes near. */
  body: Object3D | null;
  /** The NASA model has been asked for. */
  asked: boolean;
  /** The rig, when this is a suited crew member. */
  suit: Suit | null;
  shadows: boolean;
}

/** The NASA model is fetched within this distance; further off, the drawn stand-in is all a few pixels need. */
const MODEL_WITHIN_M = 260;
/** Nothing is drawn past this: a rover there is smaller than a pixel. */
const DRAWN_WITHIN_M = 900;
/** The sun's shadow map reaches this far from the viewer. */
const SHADOW_WITHIN_M = 95;
const RAD = Math.PI / 180;

function setShadows(root: Object3D, on: boolean): void {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) o.castShadow = on;
  });
}

/**
 * The things standing in the scene. Each is a drawn stand-in until its NASA model has downloaded, and
 * is seated on the drawn ground whenever that ground is rebuilt.
 */
export function createProps(scene: Scene, frame: Frame, specs: readonly PropSpec[], heightAt: (x: number, z: number) => number | null) {
  let disposed = false;
  const items: Item[] = specs.map((spec) => {
    const [x, z] = toLocal(frame, spec.lon, spec.lat);
    const anchor = new Group();
    anchor.name = spec.id;
    anchor.visible = false;
    scene.add(anchor);
    return { spec, x, z, anchor, body: null, asked: false, suit: null, shadows: true };
  });
  const clearings: readonly Clearing[] = items.map((i) => ({ x: i.x, z: i.z, r: MODELS[i.spec.model].clearM }));

  /** Puts it on the ground. False where there is no fine ground under it yet. */
  const seat = (item: Item): boolean => {
    const { spec, x, z, anchor } = item;
    const ground = heightAt(x, z);
    if (ground === null) return false;
    const h = spec.headingDeg * RAD;
    const stance = MODELS[spec.model].stance;
    let s: Seat = { y: ground, pitch: 0, roll: 0 };
    if (stance) {
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const rx = Math.cos(h);
      const rz = Math.sin(h);
      const at = (f: number, r: number) => heightAt(x + (fx * f * stance.length + rx * r * stance.width) / 2, z + (fz * f * stance.length + rz * r * stance.width) / 2) ?? ground;
      s = seatOnWheels([at(1, -1), at(1, 1), at(-1, -1), at(-1, 1)], stance.width, stance.length);
    }
    anchor.position.set(x, s.y, z);
    anchor.rotation.set(s.pitch, -h, s.roll, 'YXZ');
    return true;
  };

  const swapBody = (item: Item, body: Object3D): void => {
    if (item.body) {
      item.anchor.remove(item.body);
      disposeObject(item.body);
    }
    item.body = body;
    setShadows(body, item.shadows);
    item.anchor.add(body);
  };

  const fetchModel = (item: Item): void => {
    item.asked = true;
    loadModel(item.spec.model)
      .then((model) => {
        if (disposed) return;
        // A suit gets its own skeleton so it can stand at ease and walk; everything else is a plain copy.
        const suit = item.spec.model === 'z2' ? rigSuit(model) : null;
        item.suit = suit;
        swapBody(item, suit ? suit.root : cloneSkinned(model));
      })
      .catch(() => {
        // The stand-in stays; coming near again tries once more.
        item.asked = false;
      });
  };

  return {
    clearings,
    /** Call every frame; `groundChanged` when the near ground was rebuilt. */
    update(viewX: number, viewZ: number, groundChanged: boolean): void {
      for (const item of items) {
        const d = Math.hypot(item.x - viewX, item.z - viewZ);
        if (d > DRAWN_WITHIN_M) {
          item.anchor.visible = false;
          continue;
        }
        if (!item.body) swapBody(item, standIn(item.spec.model));
        if (!item.asked && d < MODEL_WITHIN_M) fetchModel(item);
        if (groundChanged || !item.anchor.visible) item.anchor.visible = seat(item);
        // A suited crew member stands at ease: breathing, shifting weight, looking about.
        if (item.suit && d < 120) item.suit.pose(0, 0, 1.3, performance.now() / 1000);
        const shadows = d < SHADOW_WITHIN_M;
        if (shadows !== item.shadows && item.body) {
          item.shadows = shadows;
          setShadows(item.body, shadows);
        }
      }
    },
    /** The seated prop nearest a point, within `withinM`, or null. */
    nearest(x: number, z: number, withinM: number): string | null {
      let best: string | null = null;
      let bestD = withinM;
      for (const item of items) {
        const d = Math.hypot(item.x - x, item.z - z);
        if (item.anchor.visible && d < bestD) {
          best = item.spec.id;
          bestD = d;
        }
      }
      return best;
    },
    /** Where each prop stands, for tests. `real` once the NASA model has replaced the stand-in. */
    list(): { id: string; x: number; z: number; y: number; seated: boolean; real: boolean }[] {
      return items.map((i) => ({ id: i.spec.id, x: i.x, z: i.z, y: i.anchor.position.y, seated: i.anchor.visible, real: i.body !== null && !i.body.name.endsWith('-stand-in') }));
    },
    dispose(): void {
      disposed = true;
      for (const item of items) {
        scene.remove(item.anchor);
        if (item.body) disposeObject(item.body);
        item.suit?.dispose();
      }
    },
  };
}
