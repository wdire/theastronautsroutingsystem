import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, type Scene } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { loadModel, standIn } from './models';
import { MODELS, type ModelName } from './modelSpecs';
import { seatOnWheels } from './props';
import { cyclesPerMetre, rigSuit, standLower, type Suit } from './suit';
import { rollWheels, wheelsOf } from './wheels';
import { dress, nameTag, type CrewLook } from './crewLook';

/** Where the party is asked to be: the crew's place on the route, in scene metres. */
export interface PartyTarget {
  x: number;
  z: number;
  headingDeg: number;
  /** Ground speed in the simulation, m/s (already multiplied by the clock speed). */
  speedMs: number;
  moving: boolean;
}

interface Member {
  anchor: Group;
  suit: Suit | null;
  x: number;
  z: number;
  heading: number;
  phase: number;
  /** A vehicle's turning wheels. */
  wheels: { pivot: Object3D; radius: number }[];
  /** 0 standing to 1 walking, eased. */
  walk: number;
  look: CrewLook | null;
  undress: (() => void) | null;
  /** The ground's rise per metre ahead and to the right, under a walker, so each boot meets it. */
  grade: { ahead: number; right: number };
  /** Ingenuity's rotor, turned about the mast, and the blur disc it leaves at speed. */
  rotor: { pivot: Group; blur: Mesh[] } | null;
}

/** Rotor turns per second as drawn: fast enough to read as spinning, slow enough not to strobe backwards. */
const ROTOR_REV_S = 7;

/**
 * Pulls Ingenuity's rotor out so it can turn: the model holds both rotors and the mast in one node, tilted in
 * its file, so it is hung from an upright pivot at its own place. Two faint discs stand for the blades' blur.
 */
function rigRotor(body: Object3D): Member['rotor'] {
  let rotor: Object3D | undefined;
  body.traverse((o) => {
    if (!rotor && o.name.startsWith('rotors')) rotor = o;
  });
  const parent = rotor?.parent;
  if (!rotor || !parent) return null;
  const pivot = new Group();
  pivot.name = 'rotor-pivot';
  pivot.position.copy(rotor.position);
  parent.add(pivot);
  pivot.add(rotor);
  rotor.position.set(0, 0, 0);
  const material = new MeshBasicMaterial({ color: 0x2a2724, transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide });
  const blur: Mesh[] = [];
  // The two rotors sit about 18 cm apart on the mast; the parent's scale is undone so the discs are in metres.
  const s = 1 / (parent.getWorldScale(pivot.position.clone()).y || 1);
  for (const dy of [-0.085, 0.085]) {
    const disc = new Mesh(new CircleGeometry(0.6 * s, 40), material);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(pivot.position.x, pivot.position.y + dy * s, pivot.position.z);
    disc.renderOrder = 2;
    disc.userData.dispose = () => {
      disc.geometry.dispose();
      material.dispose();
    };
    parent.add(disc);
    blur.push(disc);
  }
  return { pivot, blur };
}

const RAD = Math.PI / 180;
/** Walkers go in single file, each this far behind the one ahead, on the leader's footsteps. */
const FILE_GAP_M = 2.4;
const HOVER_M = 6;

function modelFor(vehicle: VehicleId): ModelName {
  if (vehicle === 'foot') return 'z2';
  if (vehicle === 'robotRover') return 'perseverance';
  if (vehicle === 'heli') return 'ingenuity';
  return 'sev';
}

/** Turns `from` toward `to` (radians) by at most `maxStep`, the short way round. */
function turnToward(from: number, to: number, maxStep: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

/**
 * The crew or vehicle of a running mission, moving through the scene: the mission's own crew in single
 * file, in the walking order the commander set, or the rover or helicopter. They follow the simulation's
 * position, stand on the drawn ground, and face the way they move on screen.
 */
export function createParty(scene: Scene, vehicle: VehicleId, heightAt: (x: number, z: number) => number, crew: readonly CrewLook[]) {
  const model = modelFor(vehicle);
  const walkers = vehicle === 'foot';
  const looks: (CrewLook | null)[] = walkers ? (crew.length > 0 ? crew.slice(0, 8) : [null]) : [null];
  const members: Member[] = looks.map((look) => {
    const anchor = new Group();
    anchor.add(standIn(model));
    anchor.visible = false;
    scene.add(anchor);
    return { anchor, suit: null, x: 0, z: 0, heading: 0, phase: 0, wheels: [], walk: 0, look, undress: null, rotor: null, grade: { ahead: 0, right: 0 } };
  });
  // The helmet camera sits in the visitor's own member; without a roster, the last in file.
  const meIndex = Math.max(0, looks.findIndex((l) => l?.me));
  const viewIndex = looks.some((l) => l?.me) ? meIndex : members.length - 1;
  let disposed = false;
  let placed = false;
  let firstPerson = false;
  let clock = 0;
  // The leader's recent footsteps, newest last, for the second walker to follow.
  const trail: { x: number; z: number }[] = [];

  void loadModel(model)
    .then((loaded) => {
      if (disposed) return;
      for (const m of members) {
        const suit = walkers ? rigSuit(loaded) : null;
        const body: Object3D = suit ? suit.root : cloneSkinned(loaded);
        m.suit = suit;
        m.wheels = suit ? [] : wheelsOf(body);
        m.anchor.clear();
        m.anchor.add(body);
        if (vehicle === 'heli') m.rotor = rigRotor(body);
        if (suit && m.look) {
          m.undress = dress(suit.root, m.look);
          m.anchor.add(nameTag(m.look));
        }
      }
    })
    .catch(() => undefined); // The stand-ins stay.

  const seat = (m: Member): void => {
    const h = m.heading;
    const stance = MODELS[model].stance;
    if (vehicle === 'heli') {
      m.anchor.position.set(m.x, heightAt(m.x, m.z) + HOVER_M, m.z);
      m.anchor.rotation.set(0.08, -h, 0, 'YXZ');
    } else if (stance) {
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const at = (f: number, r: number) => heightAt(m.x + (fx * f * stance.length + -fz * r * stance.width) / 2, m.z + (fz * f * stance.length + fx * r * stance.width) / 2);
      const s = seatOnWheels([at(1, -1), at(1, 1), at(-1, -1), at(-1, 1)], stance.width, stance.length);
      m.anchor.position.set(m.x, s.y, m.z);
      m.anchor.rotation.set(s.pitch, -h, s.roll, 'YXZ');
    } else {
      // A walker stands upright: the body is at the height of the ground under its middle, and each boot is
      // lowered or raised to the ground under it (the grade below), so neither floats nor sinks on a slope.
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const ahead = (heightAt(m.x + fx * 0.4, m.z + fz * 0.4) - heightAt(m.x - fx * 0.4, m.z - fz * 0.4)) / 0.8;
      const right = (heightAt(m.x - fz * 0.25, m.z + fx * 0.25) - heightAt(m.x + fz * 0.25, m.z - fx * 0.25)) / 0.5;
      m.grade.ahead = Math.max(-0.6, Math.min(0.6, ahead));
      m.grade.right = Math.max(-0.6, Math.min(0.6, right));
      // On a slope the boot on the low side reaches down, so the body is lowered as far as that boot needs.
      m.anchor.position.set(m.x, heightAt(m.x, m.z) - standLower(m.grade), m.z);
      m.anchor.rotation.set(0, -h, 0, 'YXZ');
    }
    m.anchor.visible = true;
  };

  /** The point `gap` metres back from the leader along its trail, or null while the trail is shorter than that. */
  const alongTrail = (lead: { x: number; z: number }, gap: number): { x: number; z: number } | null => {
    let along = 0;
    let prev = { x: lead.x, z: lead.z };
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const p = trail[i]!;
      const seg = Math.hypot(prev.x - p.x, prev.z - p.z);
      if (along + seg >= gap && seg > 0) {
        const t = (gap - along) / seg;
        return { x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t };
      }
      along += seg;
      prev = p;
    }
    return null;
  };

  return {
    /** Moves the party toward its target. `dt` in seconds of real time. */
    update(target: PartyTarget, dt: number): void {
      clock += dt;
      const lead = members[0];
      if (!lead) return;
      const jump = Math.hypot(target.x - lead.x, target.z - lead.z);
      if (!placed || jump > 60) {
        // First frame, or the clock leapt: stand where the simulation says, in file along the heading.
        placed = true;
        trail.length = 0;
        const h = target.headingDeg * RAD;
        members.forEach((m, i) => {
          m.x = target.x - Math.sin(h) * FILE_GAP_M * i;
          m.z = target.z + Math.cos(h) * FILE_GAP_M * i;
          m.heading = h;
        });
        // The file just laid out is the trail the followers walk on, last in file first.
        for (let i = members.length - 1; i >= 0; i -= 1) trail.push({ x: members[i]!.x, z: members[i]!.z });
      } else {
        const beforeX = lead.x;
        const beforeZ = lead.z;
        // Ease onto the target. It moves every frame (src/sim/smoothTime.ts), so the easing only rounds off a
        // correction; a slow one would leave the party trailing far behind at 100x.
        const k = Math.min(1, dt * 18);
        lead.x += (target.x - lead.x) * k;
        lead.z += (target.z - lead.z) * k;
        const stepM = Math.hypot(lead.x - beforeX, lead.z - beforeZ);
        rollWheels(lead.wheels, stepM);
        if (stepM > 0.004) {
          // Face the way it actually moves on screen, turning at a rate a body can.
          lead.heading = turnToward(lead.heading, Math.atan2(lead.x - beforeX, -(lead.z - beforeZ)), dt * 3.2);
          // At high clock speeds the legs would blur: the walk is drawn no faster than a brisk stride.
          lead.phase += Math.min(stepM * cyclesPerMetre(stepM / Math.max(dt, 1e-3)), dt * 2.4);
        }
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(lead.x - last.x, lead.z - last.z) > 0.25) {
          trail.push({ x: lead.x, z: lead.z });
          if (trail.length > 400) trail.shift();
        }
        // Each follower stands on the leader's footsteps exactly its place in file back, measured along the
        // trail: the file keeps its spacing at any clock speed instead of stretching out behind the camera.
        for (let n = 1; n < members.length; n += 1) {
          const follower = members[n]!;
          const spot = alongTrail(lead, FILE_GAP_M * n);
          const bx = follower.x;
          const bz = follower.z;
          if (spot) {
            follower.x = spot.x;
            follower.z = spot.z;
          }
          const moved = Math.hypot(follower.x - bx, follower.z - bz);
          if (moved > 0.004) {
            follower.heading = turnToward(follower.heading, Math.atan2(follower.x - bx, -(follower.z - bz)), dt * 3.2);
            follower.phase += Math.min(moved * cyclesPerMetre(moved / Math.max(dt, 1e-3)), dt * 2.4);
          }
        }
      }
      for (const m of members) {
        seat(m);
        // The walk eases in and out rather than snapping between standing and striding.
        m.walk += ((target.moving ? 1 : 0) - m.walk) * Math.min(1, dt * 3);
        m.suit?.pose(m.phase, m.walk, 1 / cyclesPerMetre(target.speedMs), clock, m.grade);
        // Ingenuity hovers, so its rotor never stops; it turns one way, as the two counter-rotating blades blur.
        if (m.rotor) m.rotor.pivot.rotation.y = (clock * ROTOR_REV_S * Math.PI * 2) % (Math.PI * 2);
      }
      // Seen through its own eyes, the visitor's member (or the vehicle) is not drawn: the camera is inside it.
      const own = members[viewIndex];
      if (own && firstPerson) own.anchor.visible = false;
    },
    setFirstPerson(on: boolean): void {
      firstPerson = on;
    },
    /** The leader's place and heading, for the cameras. */
    focus(): { x: number; y: number; z: number; heading: number; rear: { x: number; z: number; heading: number } } {
      const lead = members[0];
      const rear = members[viewIndex] ?? lead;
      return {
        x: lead?.x ?? 0,
        y: lead?.anchor.position.y ?? 0,
        z: lead?.z ?? 0,
        heading: lead?.heading ?? 0,
        rear: { x: rear?.x ?? 0, z: rear?.z ?? 0, heading: rear?.heading ?? 0 },
      };
    },
    /** How far the lead vehicle's first wheel has turned, radians; for the checks. */
    wheelTurn(): number {
      return members[0]?.wheels[0]?.pivot.rotation.x ?? 0;
    },
    /** How many turning wheels the lead vehicle has. */
    wheelCount(): number {
      return members[0]?.wheels.length ?? 0;
    },
    /** Eye height of whoever the first-person camera sits in, m. */
    eyeM: VEHICLES[vehicle].eyeHeightM,
    /** How much room the party takes, for the chase camera's distance. */
    sizeM: walkers ? 2 + FILE_GAP_M * Math.min(3, members.length - 1) : Math.max(...(MODELS[model].stance ? [MODELS[model].stance.length, MODELS[model].stance.width] : [1.5])) + 2,
    dispose(): void {
      disposed = true;
      for (const m of members) {
        scene.remove(m.anchor);
        m.suit?.dispose();
        m.undress?.();
        m.anchor.traverse((o) => (o.userData.dispose as (() => void) | undefined)?.());
      }
    },
  };
}
