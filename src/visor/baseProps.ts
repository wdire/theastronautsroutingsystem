/**
 * The parts of a base that have no NASA model: a solar array, a landing pad and a radio mast. Plain drawn
 * shapes at their real sizes, front to the north (-z), standing on y = 0.
 */
import { GREEN_R, GREEN_Z, HUB_CAP, HUB_R, HUB_WALL, MODULE_LEN, MODULE_NEAR, MODULE_R, MODULE_Y, SINK } from './stationPlan';
import { BoxGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RingGeometry, SphereGeometry, TorusGeometry, type BufferGeometry, type Material } from 'three';

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

/** A pressurised tunnel, 9 m long and 2.4 m across, joining two habitat modules; its front faces north. */
export function tunnel(): Group {
  const g = new Group();
  g.name = 'tunnel';
  const tube = part(new CylinderGeometry(1.2, 1.2, 9, 24, 1, true), dish, 0, 1.75, 0);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  // Ribs every metre and a half, and two feet under it.
  for (let z = -4; z <= 4; z += 1.6) {
    const rib = part(new CylinderGeometry(1.26, 1.26, 0.12, 24), frame, 0, 1.75, z);
    rib.rotation.x = Math.PI / 2;
    g.add(rib);
  }
  for (const z of [-3, 3]) g.add(part(new BoxGeometry(1.6, 0.6, 0.4), frame, 0, 0.3, z));
  return g;
}

const fabric = new MeshStandardMaterial({ color: 0xe9e4db, roughness: 0.82, metalness: 0 });
const fabricShade = new MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.85, metalness: 0 });
const stripe = new MeshStandardMaterial({ color: 0xd2662f, roughness: 0.7, metalness: 0 });
const berm = new MeshStandardMaterial({ color: 0x8e5f43, roughness: 1, metalness: 0 });
const glass = new MeshStandardMaterial({ color: 0x1b2128, roughness: 0.18, metalness: 0.6, emissive: 0xffb36b, emissiveIntensity: 0.1 });
const greenhouseSkin = new MeshStandardMaterial({ color: 0xdff0e4, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide });
const leaves = new MeshStandardMaterial({ color: 0x4f8a3c, roughness: 0.8, metalness: 0, emissive: 0xc44fd8, emissiveIntensity: 0.12 });
const growLight = new MeshStandardMaterial({ color: 0xff7be3, emissive: 0xff5ad8, emissiveIntensity: 1.4 });

/** A domed cylinder standing on y = 0, its wall carried down below the ground so it never floats on a slope. */
function dome(r: number, wall: number, cap: number, skin: Material, x: number, z: number, segments = 48): Group {
  const g = new Group();
  const below = 1.6;
  g.add(part(new CylinderGeometry(r, r, wall + below, segments, 1, true), skin, x, (wall - below) / 2, z));
  const top = part(new SphereGeometry(r, segments, 14, 0, Math.PI * 2, 0, Math.PI / 2), skin, x, wall, z);
  top.scale.y = cap / r;
  g.add(top);
  return g;
}

/** A tunnel between two points at one height, running SINK into each end. Ribbed, on feet. */
function link(x0: number, z0: number, x1: number, z1: number, y: number, r: number): Group {
  const g = new Group();
  const len = Math.hypot(x1 - x0, z1 - z0);
  const turn = Math.atan2(x1 - x0, z1 - z0);
  g.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  g.rotation.y = turn;
  const tube = part(new CylinderGeometry(r, r, len, 28, 1, true), fabric, 0, y, 0);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const ribs = Math.max(2, Math.round((len - 2 * SINK) / 1.2));
  for (let i = 0; i <= ribs; i += 1) {
    const z = -len / 2 + SINK + ((len - 2 * SINK) * i) / ribs;
    const rib = part(new CylinderGeometry(r + 0.06, r + 0.06, 0.14, 28, 1, true), fabricShade, 0, y, z);
    rib.rotation.x = Math.PI / 2;
    g.add(rib);
  }
  // Feet from below the ground up into the tube.
  const footH = y - r + 0.25 + 1.2;
  for (const z of [-(len / 2 - SINK - 1), len / 2 - SINK - 1]) g.add(part(new BoxGeometry(r * 1.4, footH, 0.4), frame, 0, footH / 2 - 1.2, z));
  return g;
}

/** A round window on a wall of radius r, at angle `a` (0 faces north, -z) and height y, lit from inside. */
function windowAt(r: number, a: number, y: number, cx: number, cz: number, size = 0.45): Group {
  const g = new Group();
  g.position.set(cx + Math.sin(a) * (r + 0.02), y, cz - Math.cos(a) * (r + 0.02));
  g.rotation.y = -a + Math.PI;
  g.add(part(new CircleGeometry(size, 24), glass, 0, 0, 0, false));
  g.add(part(new RingGeometry(size, size + 0.1, 24), frame, 0, 0, -0.005, false));
  return g;
}

/**
 * Jezero Station: a domed hub 14 m across with an airlock at its front, two laboratory modules either side
 * and a greenhouse behind, all joined by pressurised tunnels laid out from one set of numbers, so every joint
 * meets. Standing on y = 0, front (the airlock door) to the north. About 40 m by 30 m.
 */
export function station(): Group {
  const g = new Group();
  g.name = 'station';

  // Hub: regolith banked against its foot for shielding, a band at waist height, windows, a hatch on top.
  g.add(dome(HUB_R, HUB_WALL, HUB_CAP, fabric, 0, 0));
  g.add(part(new CylinderGeometry(HUB_R + 0.25, HUB_R + 1.6, 1.5, 48), berm, 0, -0.2, 0));
  const band = part(new CylinderGeometry(HUB_R + 0.03, HUB_R + 0.03, 0.3, 48, 1, true), stripe, 0, 1.15, 0);
  g.add(band);
  for (const y of [2.2, HUB_WALL]) g.add(part(new CylinderGeometry(HUB_R + 0.04, HUB_R + 0.04, 0.08, 48, 1, true), fabricShade, 0, y, 0));
  for (const lat of [0.42, 0.78]) {
    const ring = part(new CylinderGeometry(HUB_R * Math.cos(lat) + 0.04, HUB_R * Math.cos(lat) + 0.04, 0.08, 48, 1, true), fabricShade, 0, HUB_WALL + HUB_CAP * Math.sin(lat), 0);
    g.add(ring);
  }
  g.add(part(new CylinderGeometry(1.1, 1.2, 0.5, 24), frame, 0, HUB_WALL + HUB_CAP + 0.1, 0));
  for (const a of [0.55, 1.05, 2.1, 2.6, -0.55, -1.05, -2.1, -2.6]) g.add(windowAt(HUB_R, a, 2.65, 0, 0));

  // Airlock at the front: a short upright cylinder set into the hub, a door facing out, a light over it.
  const lockZ = -(HUB_R + 0.9);
  g.add(dome(1.6, 2.8, 0.7, fabricShade, 0, lockZ, 28));
  g.add(part(new BoxGeometry(1.1, 2.1, 0.16), frame, 0, 1.15, lockZ - 1.56));
  g.add(part(new BoxGeometry(0.85, 1.85, 0.06), glass, 0, 1.15, lockZ - 1.65, false));
  g.add(part(new SphereGeometry(0.1, 10, 8), beacon, 0, 2.45, lockZ - 1.6, false));
  g.add(part(new BoxGeometry(1.8, 0.25, 1.2), slab, 0, 0.0, lockZ - 2.1, false));

  // Side modules: horizontal cans on cradles, windows along the front, joined to the hub at the module's height.
  for (const side of [-1, 1]) {
    const cx = side * (MODULE_NEAR + MODULE_LEN / 2);
    const body = part(new CylinderGeometry(MODULE_R, MODULE_R, MODULE_LEN, 36, 1, true), fabric, cx, MODULE_Y, 0);
    body.rotation.z = Math.PI / 2;
    g.add(body);
    for (const end of [MODULE_NEAR, MODULE_NEAR + MODULE_LEN]) {
      const cap = part(new SphereGeometry(MODULE_R, 36, 16), fabric, side * end, MODULE_Y, 0);
      cap.scale.x = 0.42;
      g.add(cap);
    }
    for (let i = 0; i < 5; i += 1) {
      const ring = part(new CylinderGeometry(MODULE_R + 0.05, MODULE_R + 0.05, 0.12, 36, 1, true), fabricShade, side * (MODULE_NEAR + 0.9 + i * 1.8), MODULE_Y, 0);
      ring.rotation.z = Math.PI / 2;
      g.add(ring);
    }
    const strip = part(new CylinderGeometry(MODULE_R + 0.02, MODULE_R + 0.02, MODULE_LEN * 0.92, 36, 1, true, Math.PI * 0.97, Math.PI * 0.06), stripe, cx, MODULE_Y, 0);
    strip.rotation.z = Math.PI / 2;
    g.add(strip);
    // Windows on the upper front of the hull, 22 degrees above the waist, facing out along the hull.
    const up = (22 * Math.PI) / 180;
    for (const dx of [-2.7, -0.9, 0.9, 2.7]) {
      const w = part(new BoxGeometry(0.9, 0.5, 0.05), glass, cx + dx, MODULE_Y + (MODULE_R + 0.03) * Math.sin(up), -(MODULE_R + 0.03) * Math.cos(up), false);
      w.rotation.x = up;
      g.add(w);
    }
    for (const dx of [-2.8, 2.8]) g.add(part(new BoxGeometry(0.6, 2.2, MODULE_R * 1.7), frame, cx + dx, MODULE_Y - MODULE_R - 0.75, 0));
    // The tunnel to the hub, at the module's own height less a little, sunk into the hub wall and the module's end.
    g.add(link(side * (HUB_R - SINK), 0, side * (MODULE_NEAR + SINK), 0, MODULE_Y - 0.55, 1.15));
    // Two tanks beside the far end.
    for (const dz of [-1.4, 1.4]) {
      g.add(part(new SphereGeometry(0.85, 20, 14), frame, side * (MODULE_NEAR + MODULE_LEN + 2.4), 1.25, MODULE_R + 1.6 + dz));
      g.add(part(new CylinderGeometry(0.08, 0.08, 1.4, 8), frame, side * (MODULE_NEAR + MODULE_LEN + 2.4), 0.2, MODULE_R + 1.6 + dz));
    }
  }

  // Greenhouse behind: a clear dome on a low wall, its frame showing, beds of plants under pink grow lights.
  g.add(part(new CylinderGeometry(GREEN_R, GREEN_R, 2.4, 40, 1, true), fabricShade, 0, -0.2, GREEN_Z));
  g.add(dome(GREEN_R - 0.02, 1.0, 2.8, greenhouseSkin, 0, GREEN_Z, 40));
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const holder = new Group();
    holder.position.set(0, 1.0, GREEN_Z);
    holder.rotation.y = a;
    const arc = new Mesh(new TorusGeometry(GREEN_R, 0.05, 6, 24, Math.PI / 2), frame);
    arc.scale.set(1, 2.8 / GREEN_R, 1);
    holder.add(arc);
    g.add(holder);
  }
  for (const dx of [-1.8, 0, 1.8]) {
    g.add(part(new BoxGeometry(1.1, 0.5, 4.6), slab, dx, 1.25, GREEN_Z + 0.2, false));
    g.add(part(new BoxGeometry(0.95, 0.45, 4.4), leaves, dx, 1.65, GREEN_Z + 0.2, false));
    g.add(part(new BoxGeometry(0.8, 0.06, 4.2), growLight, dx, 2.9, GREEN_Z + 0.2, false));
  }
  // Low enough to stay under the glass where it ends inside the greenhouse.
  g.add(link(0, HUB_R - SINK, 0, GREEN_Z - GREEN_R + SINK, 1.2, 0.9));

  return g;
}
