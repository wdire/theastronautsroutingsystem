import { Group, type Object3D, type Scene } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { loadModel, standIn } from './models';
import { MODELS, type ModelName } from './modelSpecs';
import { seatOnWheels } from './props';
import { cyclesPerMetre, rigSuit, type Suit } from './suit';

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
}

const RAD = Math.PI / 180;
/** Two walkers in single file, the second this far behind on the first one's footsteps. */
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
 * The crew or vehicle of a running mission, moving through the scene: two suited walkers in single
 * file, or the rover or helicopter. They follow the simulation's position, stand on the drawn ground,
 * and face the way they move on screen.
 */
export function createParty(scene: Scene, vehicle: VehicleId, heightAt: (x: number, z: number) => number) {
  const model = modelFor(vehicle);
  const walkers = vehicle === 'foot';
  const members: Member[] = Array.from({ length: walkers ? 2 : 1 }, () => {
    const anchor = new Group();
    anchor.add(standIn(model));
    anchor.visible = false;
    scene.add(anchor);
    return { anchor, suit: null, x: 0, z: 0, heading: 0, phase: 0 };
  });
  let disposed = false;
  let placed = false;
  let firstPerson = false;
  // The leader's recent footsteps, newest last, for the second walker to follow.
  const trail: { x: number; z: number }[] = [];

  void loadModel(model)
    .then((loaded) => {
      if (disposed) return;
      for (const m of members) {
        const suit = walkers ? rigSuit(loaded) : null;
        const body: Object3D = suit ? suit.root : cloneSkinned(loaded);
        m.suit = suit;
        m.anchor.clear();
        m.anchor.add(body);
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
      m.anchor.position.set(m.x, heightAt(m.x, m.z), m.z);
      m.anchor.rotation.set(0, -h, 0, 'YXZ');
    }
    m.anchor.visible = true;
  };

  return {
    /** Moves the party toward its target. `dt` in seconds of real time. */
    update(target: PartyTarget, dt: number): void {
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
      } else {
        const beforeX = lead.x;
        const beforeZ = lead.z;
        // Ease onto the target: the simulation reports ten times a second, the screen draws sixty.
        const k = Math.min(1, dt * 8);
        lead.x += (target.x - lead.x) * k;
        lead.z += (target.z - lead.z) * k;
        const stepM = Math.hypot(lead.x - beforeX, lead.z - beforeZ);
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
        const second = members[1];
        if (second) {
          // The second walker heads for the leader's footstep one file gap back.
          let spot = trail[0] ?? { x: lead.x, z: lead.z };
          for (let i = trail.length - 1; i >= 0; i -= 1) {
            const p = trail[i];
            if (p && Math.hypot(lead.x - p.x, lead.z - p.z) >= FILE_GAP_M) {
              spot = p;
              break;
            }
          }
          const bx = second.x;
          const bz = second.z;
          second.x += (spot.x - second.x) * k;
          second.z += (spot.z - second.z) * k;
          const moved = Math.hypot(second.x - bx, second.z - bz);
          if (moved > 0.004) {
            second.heading = turnToward(second.heading, Math.atan2(second.x - bx, -(second.z - bz)), dt * 3.2);
            second.phase += Math.min(moved * cyclesPerMetre(moved / Math.max(dt, 1e-3)), dt * 2.4);
          }
        }
      }
      for (const m of members) {
        seat(m);
        m.suit?.pose(m.phase, target.moving ? 1 : 0);
      }
      // Seen through its own eyes, the last in file (or the vehicle) is not drawn: the camera is inside it.
      const rear = members[members.length - 1];
      if (rear && firstPerson) rear.anchor.visible = false;
    },
    setFirstPerson(on: boolean): void {
      firstPerson = on;
    },
    /** The leader's place and heading, for the cameras. */
    focus(): { x: number; y: number; z: number; heading: number; rear: { x: number; z: number; heading: number } } {
      const lead = members[0];
      const rear = members[members.length - 1] ?? lead;
      return {
        x: lead?.x ?? 0,
        y: lead?.anchor.position.y ?? 0,
        z: lead?.z ?? 0,
        heading: lead?.heading ?? 0,
        rear: { x: rear?.x ?? 0, z: rear?.z ?? 0, heading: rear?.heading ?? 0 },
      };
    },
    /** Eye height of whoever the first-person camera sits in, m. */
    eyeM: VEHICLES[vehicle].eyeHeightM,
    /** How much room the party takes, for the chase camera's distance. */
    sizeM: walkers ? 2 + FILE_GAP_M : Math.max(...(MODELS[model].stance ? [MODELS[model].stance.length, MODELS[model].stance.width] : [1.5])) + 2,
    dispose(): void {
      disposed = true;
      for (const m of members) {
        scene.remove(m.anchor);
        m.suit?.dispose();
      }
    },
  };
}
