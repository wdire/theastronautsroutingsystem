/**
 * Other people who have Rover View open nearby, drawn walking where they are. Presence reports each of
 * them about once a second; between reports they walk on toward the last place heard, so they move
 * smoothly rather than hop. Someone who closes the view or goes out of range is taken away.
 */
import { Group, type Scene } from 'three';
import { loadModel } from './models';
import { rigSuit, cyclesPerMetre, type Suit } from './suit';
import { dress, nameTag } from './crewLook';
import { toLocal, type Frame } from './frame';

export interface WalkerSpec {
  id: string;
  name: string;
  color: string;
  lon: number;
  lat: number;
  headingDeg: number;
  moving: boolean;
}

interface Body {
  anchor: Group;
  suit: Suit | null;
  undress: (() => void) | null;
  x: number;
  z: number;
  tx: number;
  tz: number;
  heading: number;
  targetHeading: number;
  phase: number;
  walk: number;
  moving: boolean;
}

/** Farther than this, m, nobody is drawn: they would be a few pixels on the horizon. */
const RANGE_M = 1500;

export function createWalkers(scene: Scene, frame: Frame, heightAt: (x: number, z: number) => number) {
  const bodies = new Map<string, Body>();
  let disposed = false;
  let clock = 0;

  const add = (w: WalkerSpec, x: number, z: number): Body => {
    const anchor = new Group();
    scene.add(anchor);
    const heading = (w.headingDeg * Math.PI) / 180;
    const body: Body = { anchor, suit: null, undress: null, x, z, tx: x, tz: z, heading, targetHeading: heading, phase: 0, walk: 0, moving: w.moving };
    void loadModel('z2')
      .then((model) => {
        if (disposed || !bodies.has(w.id)) return;
        const suit = rigSuit(model);
        if (!suit) return;
        body.suit = suit;
        anchor.add(suit.root);
        body.undress = dress(suit.root, { id: w.id, name: w.name, role: 'Online', color: w.color, android: false, me: false });
        anchor.add(nameTag({ id: w.id, name: w.name, role: 'Exploring', color: w.color, android: false, me: false }));
      })
      .catch(() => undefined);
    return body;
  };

  const remove = (id: string) => {
    const b = bodies.get(id);
    if (!b) return;
    scene.remove(b.anchor);
    b.suit?.dispose();
    b.undress?.();
    b.anchor.traverse((o) => (o.userData.dispose as (() => void) | undefined)?.());
    bodies.delete(id);
  };

  return {
    /** The latest reports. */
    set(list: readonly WalkerSpec[]): void {
      const seen = new Set<string>();
      for (const w of list) {
        const [x, z] = toLocal(frame, w.lon, w.lat);
        if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > RANGE_M + 200) continue;
        seen.add(w.id);
        const b = bodies.get(w.id) ?? (() => {
          const fresh = add(w, x, z);
          bodies.set(w.id, fresh);
          return fresh;
        })();
        // A jump of more than a short walk (a new place, a teleport by the map) is taken at once.
        if (Math.hypot(x - b.x, z - b.z) > 40) {
          b.x = x;
          b.z = z;
        }
        b.tx = x;
        b.tz = z;
        b.targetHeading = (w.headingDeg * Math.PI) / 180;
        b.moving = w.moving;
      }
      for (const id of [...bodies.keys()]) if (!seen.has(id)) remove(id);
    },
    update(dt: number): void {
      clock += dt;
      for (const b of bodies.values()) {
        const dx = b.tx - b.x;
        const dz = b.tz - b.z;
        const d = Math.hypot(dx, dz);
        // Walk on toward the last report at walking pace or a little faster, never past it.
        const step = Math.min(d, Math.max(1.4, d * 1.2) * dt);
        if (d > 0.02) {
          b.x += (dx / d) * step;
          b.z += (dz / d) * step;
          b.heading = Math.atan2(dx, -dz);
          b.phase += step * cyclesPerMetre(step / Math.max(dt, 1e-3));
        } else {
          let turn = (b.targetHeading - b.heading) % (Math.PI * 2);
          if (turn > Math.PI) turn -= Math.PI * 2;
          if (turn < -Math.PI) turn += Math.PI * 2;
          b.heading += turn * Math.min(1, dt * 4);
        }
        const walking = d > 0.05;
        b.walk += ((walking ? 1 : 0) - b.walk) * Math.min(1, dt * 3);
        b.anchor.position.set(b.x, heightAt(b.x, b.z), b.z);
        b.anchor.rotation.set(0, -b.heading, 0, 'YXZ');
        b.suit?.pose(b.phase, b.walk, 1 / cyclesPerMetre(1.4), clock);
      }
    },
    count: () => bodies.size,
    dispose(): void {
      disposed = true;
      for (const id of [...bodies.keys()]) remove(id);
    },
  };
}
