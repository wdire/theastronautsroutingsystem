import { Group, type Object3D, type Scene } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { toLocal, type Frame } from './frame';
import { MODELS, disposeObject, loadModel, standIn, type ModelName } from './models';

/** Something that stands on the ground at a real place: a rover, the habitat, a parked vehicle. */
export interface PropSpec {
  id: string;
  model: ModelName;
  lon: number;
  lat: number;
  /** Compass heading its front faces, degrees clockwise from north. */
  headingDeg: number;
}

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
  // What is left of each wheel’s ground after the tilted plane is taken out.
  const twist = Math.max(fl - (mean + dPitch / 2 - dRoll / 2), fr - (mean + dPitch / 2 + dRoll / 2), rl - (mean - dPitch / 2 - dRoll / 2), rr - (mean - dPitch / 2 + dRoll / 2));
  return { y: mean + Math.max(0, twist), pitch: Math.atan2(dPitch, length), roll: Math.atan2(dRoll, width) };
}

interface Item {
  spec: PropSpec;
  x: number;
  z: number;
  anchor: Group;
  body: Object3D | null;
  requested: boolean;
  seated: boolean;
}

/** Models are fetched when the viewer comes this close, and drawn out to the edge of the near ground. */
const LOAD_WITHIN_M = 1500;
const RAD = Math.PI / 180;

/**
 * The things standing in the scene. Each is a drawn stand-in until its NASA model has downloaded, and
 * is seated on the drawn ground whenever that ground is rebuilt.
 */
export function createProps(scene: Scene, frame: Frame, heightAt: (x: number, z: number) => number | null) {
  let items: Item[] = [];
  let disposed = false;

  const seat = (item: Item): void => {
    const { spec, x, z, anchor } = item;
    const ground = heightAt(x, z);
    if (ground === null) {
      item.seated = false;
      anchor.visible = false;
      return;
    }
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
    anchor.visible = true;
    item.seated = true;
  };

  const request = (item: Item): void => {
    item.requested = true;
    item.body = standIn(item.spec.model);
    item.anchor.add(item.body);
    loadModel(item.spec.model)
      .then((model) => {
        if (disposed || !items.includes(item)) return;
        const body = cloneSkinned(model);
        if (item.body) {
          item.anchor.remove(item.body);
          disposeObject(item.body);
        }
        item.body = body;
        item.anchor.add(body);
      })
      .catch(() => undefined); // The stand-in stays.
  };

  const clear = (): void => {
    for (const item of items) {
      scene.remove(item.anchor);
      if (item.body) disposeObject(item.body);
    }
    items = [];
  };

  return {
    set(specs: readonly PropSpec[]): void {
      clear();
      items = specs.map((spec) => {
        const [x, z] = toLocal(frame, spec.lon, spec.lat);
        const anchor = new Group();
        anchor.name = spec.id;
        anchor.visible = false;
        scene.add(anchor);
        return { spec, x, z, anchor, body: null, requested: false, seated: false };
      });
    },
    /** Call every frame; `groundChanged` when the near ground was rebuilt. */
    update(viewX: number, viewZ: number, groundChanged: boolean): void {
      for (const item of items) {
        const d = Math.hypot(item.x - viewX, item.z - viewZ);
        if (!item.requested && d < LOAD_WITHIN_M) request(item);
        if (item.requested && (groundChanged || !item.seated)) seat(item);
      }
    },
    /** Discs the rocks keep out of. */
    clearings(): { x: number; z: number; r: number }[] {
      return items.map((i) => ({ x: i.x, z: i.z, r: MODELS[i.spec.model].clearM }));
    },
    /** Where each prop is, for tests and the nearby card. */
    list(): { id: string; x: number; z: number; y: number; seated: boolean; real: boolean }[] {
      return items.map((i) => ({ id: i.spec.id, x: i.x, z: i.z, y: i.anchor.position.y, seated: i.seated, real: Boolean(i.body && !i.body.name.endsWith('-stand-in')) }));
    },
    dispose(): void {
      disposed = true;
      clear();
    },
  };
}
