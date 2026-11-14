/**
 * The parts of a base that have no NASA model: a solar array, a landing pad and a radio mast. Plain drawn
 * shapes at their real sizes, front to the north (-z), standing on y = 0.
 */
import { BoxGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RingGeometry, SphereGeometry, type BufferGeometry, type Material } from 'three';

const frame = new MeshStandardMaterial({ color: 0x9a958d, roughness: 0.55, metalness: 0.35 });
const cells = new MeshStandardMaterial({ color: 0x1a2433, roughness: 0.32, metalness: 0.45, emissive: 0x0b1220, emissiveIntensity: 0.15 });
const slab = new MeshStandardMaterial({ color: 0xb59a80, roughness: 0.95, metalness: 0 });
const paint = new MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.8, metalness: 0, side: DoubleSide });
const dish = new MeshStandardMaterial({ color: 0xdedad2, roughness: 0.5, metalness: 0.2, side: DoubleSide });
const beacon = new MeshStandardMaterial({ color: 0xff5a36, emissive: 0xff5a36, emissiveIntensity: 1.6 });

function part(geometry: BufferGeometry, material: Material, x: number, y: number, z: number, shadows = true): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Four rows of six panels, 2 by 1 m each (48 m2, about 5 kW at Mars noon), tilted 25 degrees toward the noon sun. Jezero is at 18 N, so
 * the sun crosses to the south: the panels face +z (south) when the array's front faces north.
 */
export function solarArray(): Group {
  const g = new Group();
  g.name = 'solar';
  const panel = new BoxGeometry(2, 0.05, 1);
  const leg = new CylinderGeometry(0.035, 0.035, 1, 6);
  const tilt = (25 * Math.PI) / 180;
  for (let row = 0; row < 4; row += 1) {
    const z = (row - 1.5) * 2.6;
    for (let i = 0; i < 6; i += 1) {
      const x = (i - 2.5) * 2.1;
      const p = part(panel, cells, x, 1.0, z);
      p.rotation.x = -tilt;
      g.add(p);
    }
    // Two legs per row, the back one taller so the row leans south.
    for (const x of [-6.3, -2.1, 2.1, 6.3]) {
      const front = part(leg, frame, x, 0.39, z + 0.42);
      front.scale.y = 0.78;
      const back = part(leg, frame, x, 0.6, z - 0.42);
      back.scale.y = 1.2;
      g.add(front, back);
    }
    g.add(part(new BoxGeometry(12.8, 0.06, 0.06), frame, 0, 0.78, z + 0.42), part(new BoxGeometry(12.8, 0.06, 0.06), frame, 0, 1.2, z - 0.42));
  }
  return g;
}

/** A landing pad of sintered regolith, 18 m across, with a painted ring and cross for a lander's camera. */
export function landingPad(): Group {
  const g = new Group();
  g.name = 'pad';
  g.add(part(new CylinderGeometry(9, 9.3, 0.3, 48), slab, 0, 0.15, 0, false));
  const ring = part(new RingGeometry(6.2, 6.8, 48), paint, 0, 0.305, 0, false);
  ring.rotation.x = -Math.PI / 2;
  const dot = part(new CircleGeometry(0.7, 24), paint, 0, 0.305, 0, false);
  dot.rotation.x = -Math.PI / 2;
  g.add(ring, dot);
  for (const turn of [0, Math.PI / 2]) {
    const bar = part(new BoxGeometry(0.35, 0.01, 4), paint, 0, 0.305, 0, false);
    bar.rotation.y = turn;
    g.add(bar);
  }
  return g;
}

/** A 7 m radio mast with a dish pointed at the relay orbiters' sky, and a red beacon on top. */
export function radioMast(): Group {
  const g = new Group();
  g.name = 'mast';
  g.add(part(new CylinderGeometry(0.08, 0.12, 7, 8), frame, 0, 3.5, 0));
  g.add(part(new BoxGeometry(1.2, 0.08, 1.2), frame, 0, 0.04, 0));
  const d = part(new SphereGeometry(0.75, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), dish, 0, 5.6, 0.35);
  d.rotation.x = -Math.PI / 2.6;
  g.add(d);
  g.add(part(new SphereGeometry(0.09, 10, 8), beacon, 0, 7.08, 0, false));
  return g;
}
