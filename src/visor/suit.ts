import { Bone, BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Matrix3, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, type Material, type Mesh, type Object3D } from 'three';

/**
 * The Z-2 suit model is a statue: one mesh, no skeleton. This gives it bones by rule, so a crew can
 * stand at ease and walk. Everything is in the model's own space as `loadModel` hands it over: metres,
 * feet on y = 0, facing north (-z).
 */

type Side = 'L' | 'R';
type BoneName = 'pelvis' | 'spine' | 'chest' | 'head' | `shoulder${Side}` | `elbow${Side}` | `hand${Side}` | `hip${Side}` | `knee${Side}` | `ankle${Side}`;

/** Joint positions in metres, x to the suit's right-hand side of the picture, z forward negative. */
const JOINTS: Record<string, readonly [number, number, number]> = {
  pelvis: [0, 0.9, 0],
  spine: [0, 1.15, 0],
  chest: [0, 1.4, 0],
  head: [0, 1.62, 0],
  shoulder: [0.3, 1.5, -0.05],
  elbow: [0.33, 1.25, -0.24],
  hand: [0.28, 1.1, -0.55],
  hip: [0.12, 0.85, 0],
  knee: [0.18, 0.47, 0],
  ankle: [0.21, 0.13, 0],
};

const ORDER: readonly BoneName[] = ['pelvis', 'spine', 'chest', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];
const PARENT: Partial<Record<BoneName, BoneName>> = {
  spine: 'pelvis',
  chest: 'spine',
  head: 'chest',
  shoulderL: 'chest',
  elbowL: 'shoulderL',
  handL: 'elbowL',
  shoulderR: 'chest',
  elbowR: 'shoulderR',
  handR: 'elbowR',
  hipL: 'pelvis',
  kneeL: 'hipL',
  ankleL: 'kneeL',
  hipR: 'pelvis',
  kneeR: 'hipR',
  ankleR: 'kneeR',
};

function jointOf(name: BoneName): Vector3 {
  const side = name.endsWith('L') ? -1 : name.endsWith('R') ? 1 : 0;
  const base = JOINTS[side === 0 ? name : name.slice(0, -1)] ?? [0, 0, 0];
  return new Vector3(base[0] * (side === 0 ? 1 : side), base[1], base[2]);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 at `lo`, 1 at `hi`. */
const ramp = (lo: number, hi: number, v: number) => clamp01((v - lo) / (hi - lo));

/** Distance from a point to a segment, and how far along the segment the nearest point is (0 to 1). */
function toSegment(p: Vector3, a: Vector3, b: Vector3): { d: number; t: number } {
  const ab = b.clone().sub(a);
  const t = clamp01(p.clone().sub(a).dot(ab) / ab.lengthSq());
  return { d: p.distanceTo(a.clone().addScaledVector(ab, t)), t };
}

/**
 * Which bones move a vertex, and by how much. Legs by side, blended into the pelvis at the top; an
 * arm by its nearer segment; everything else along the spine by height. Exported for the tests.
 */
export function suitWeights(p: Vector3): Partial<Record<BoneName, number>> {
  const side: Side = p.x < 0 ? 'L' : 'R';
  const w: Partial<Record<BoneName, number>> = {};
  const shoulder = jointOf(`shoulder${side}`);
  const elbow = jointOf(`elbow${side}`);
  const hand = jointOf(`hand${side}`);
  const upper = toSegment(p, shoulder, elbow);
  const fore = toSegment(p, elbow, hand);
  // Past the hand the glove still belongs to the forearm.
  const beyondHand = p.z < hand.z && Math.hypot(p.x - hand.x, p.y - hand.y) < 0.16;
  const armD = Math.min(upper.d, fore.d);
  const arm = Math.abs(p.x) > 0.2 && p.y > 0.95 && p.y < 1.62 ? 1 - ramp(0.12, 0.19, armD) : 0;
  const armShare = beyondHand ? 1 : arm;

  if (armShare > 0) {
    if (beyondHand || fore.d < upper.d) {
      // Along the forearm: the elbow bone, handing over to the hand bone near the wrist.
      const wrist = beyondHand ? 1 : ramp(0.7, 1, fore.t);
      w[`elbow${side}`] = armShare * (1 - wrist);
      w[`hand${side}`] = armShare * wrist;
    } else {
      // Along the upper arm: the shoulder bone, with the elbow taking over across the joint.
      const bend = ramp(0.8, 1, upper.t) * 0.5;
      // The top of the arm stays partly with the chest so the shoulder does not tear.
      const root = (1 - ramp(0, 0.3, upper.t)) * 0.45;
      w[`shoulder${side}`] = armShare * (1 - bend) * (1 - root);
      w[`elbow${side}`] = armShare * bend;
      w.chest = (w.chest ?? 0) + armShare * (1 - bend) * root;
    }
  }

  const rest = 1 - armShare;
  if (rest > 0) {
    if (p.y < 0.98) {
      // A leg: thigh, shin and boot by height, with soft joins at the knee and the ankle.
      const intoPelvis = ramp(0.8, 0.98, p.y);
      const shin = 1 - ramp(0.42, 0.52, p.y);
      const boot = 1 - ramp(0.1, 0.17, p.y);
      const leg = rest * (1 - intoPelvis);
      w[`hip${side}`] = leg * (1 - shin);
      w[`knee${side}`] = leg * shin * (1 - boot);
      w[`ankle${side}`] = leg * shin * boot;
      w.pelvis = (w.pelvis ?? 0) + rest * intoPelvis;
    } else {
      const toSpine = ramp(0.98, 1.12, p.y);
      const toChest = ramp(1.2, 1.36, p.y);
      const toHead = ramp(1.5, 1.6, p.y);
      w.pelvis = (w.pelvis ?? 0) + rest * (1 - toSpine);
      w.spine = (w.spine ?? 0) + rest * toSpine * (1 - toChest);
      w.chest = (w.chest ?? 0) + rest * toChest * (1 - toHead);
      w.head = (w.head ?? 0) + rest * toHead;
    }
  }
  return w;
}

export interface Suit {
  root: Group;
  /**
   * Poses the suit. `phase` counts step cycles (one cycle is a left and a right step); `stride` is
   * 0 standing still and 1 walking; `cycleM` is the ground one cycle covers, so a planted boot stays
   * where it was put; `timeS` drives breathing and the small movements of someone standing.
   */
  pose(phase: number, stride: number, cycleM?: number, timeS?: number): void;
  dispose(): void;
}

/** Thigh and shin lengths of the rig, m: hip to knee and knee to ankle. */
const THIGH_M = Math.hypot(0.06, 0.38);
const SHIN_M = Math.hypot(0.03, 0.34);
/** Share of a cycle each boot is on the ground: long, for a suit this heavy in a third of a g. */
const STANCE = 0.62;
const smoothstep01 = (t: number) => t * t * (3 - 2 * t);

/**
 * Where a boot is in a cycle, relative to the point under its hip: `ahead` m forward, `lift` m up,
 * and `pitch`, the toe-up angle. On the ground it slides back at walking pace (the body moves over
 * it); in the air it swings forward on a low arc, heel first.
 */
export function footAt(q: number, stepM: number, liftM: number): { ahead: number; lift: number; pitch: number } {
  const t = ((q % 1) + 1) % 1;
  if (t < STANCE) {
    const u = t / STANCE;
    // Heel strike with the toe up, rolling flat, then onto the toe as it leaves.
    const pitch = u < 0.15 ? (1 - u / 0.15) * 0.25 : u > 0.8 ? -((u - 0.8) / 0.2) * 0.35 : 0;
    return { ahead: stepM / 2 - stepM * u, lift: 0, pitch };
  }
  const u = (t - STANCE) / (1 - STANCE);
  return { ahead: -stepM / 2 + stepM * smoothstep01(u), lift: liftM * Math.sin(Math.PI * u) ** 1.3, pitch: -0.35 * (1 - u) + 0.25 * u };
}

/** Hip and knee angles that put the ankle `ahead` m forward of and `drop` m below the hip (two-bone IK). */
export function legAngles(ahead: number, drop: number): { hip: number; knee: number } {
  const reach = Math.min(THIGH_M + SHIN_M - 1e-3, Math.max(0.2, Math.hypot(ahead, drop)));
  const toTarget = Math.atan2(ahead, drop);
  const atHip = Math.acos(Math.max(-1, Math.min(1, (THIGH_M ** 2 + reach ** 2 - SHIN_M ** 2) / (2 * THIGH_M * reach))));
  const atKnee = Math.acos(Math.max(-1, Math.min(1, (THIGH_M ** 2 + SHIN_M ** 2 - reach ** 2) / (2 * THIGH_M * SHIN_M))));
  // The knee bends forward: the thigh leans ahead of the line to the boot, the shin folds back.
  return { hip: toTarget + atHip, knee: -(Math.PI - atKnee) };
}

/** Builds a rigged suit from the loaded model. The model itself is left as it was. */
export function rigSuit(model: Object3D): Suit | null {
  let source: Mesh | null = null;
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!source && (o as Mesh).isMesh) source = o as Mesh;
  });
  const mesh = source as Mesh | null;
  if (!mesh) return null;

  // The file stores positions as 16-bit integers scaled by the node's transform. Baking the transform
  // into the integers overflows them into spikes, so the vertices are read out as floats first.
  const from = mesh.geometry;
  const pos = from.getAttribute('position');
  const nor = from.getAttribute('normal');
  const count = pos.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const v = new Vector3();
  let minY = Infinity;
  for (let i = 0; i < count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
    minY = Math.min(minY, v.y);
    if (nor) {
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      normals[i * 3] = v.x;
      normals[i * 3 + 1] = v.y;
      normals[i * 3 + 2] = v.z;
    }
  }
  // Boots on the ground.
  for (let i = 0; i < count; i += 1) positions[i * 3 + 1] = (positions[i * 3 + 1] ?? 0) - minY;

  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    v.set(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0);
    // The four strongest bones, made to add up to one.
    const top = Object.entries(suitWeights(v))
      .filter(([, weight]) => weight > 1e-4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((n, [, weight]) => n + weight, 0) || 1;
    top.forEach(([name, weight], k) => {
      skinIndex[i * 4 + k] = ORDER.indexOf(name as BoneName);
      skinWeight[i * 4 + k] = weight / sum;
    });
    if (top.length === 0) skinWeight[i * 4] = 1; // Pelvis, bone 0.
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (nor) geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  const uv = from.getAttribute('uv');
  if (uv) geometry.setAttribute('uv', uv);
  if (from.index) geometry.setIndex(from.index);
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.computeBoundingSphere();

  const bones = {} as Record<BoneName, Bone>;
  for (const name of ORDER) {
    const bone = new Bone();
    bone.name = name;
    const parent = PARENT[name];
    // A bone's position is relative to its parent's joint.
    bone.position.copy(jointOf(name));
    if (parent) {
      bone.position.sub(jointOf(parent));
      bones[parent].add(bone);
    }
    bone.rotation.order = 'YXZ';
    bones[name] = bone;
  }

  const skinned = new SkinnedMesh(geometry, mesh.material as Material | Material[]);
  skinned.castShadow = true;
  skinned.receiveShadow = true;
  skinned.frustumCulled = false;
  skinned.add(bones.pelvis);
  // World matrices must be current before binding, or the bind pose is the origin and the suit collapses.
  skinned.updateMatrixWorld(true);
  skinned.bind(new Skeleton(ORDER.map((name) => bones[name])));

  const root = new Group();
  root.name = 'z2-suit';
  root.add(skinned);
  const pelvisY = bones.pelvis.position.y;
  const hipY = jointOf('hipL').y;
  const ankleY = jointOf('ankleL').y;
  // Each walker breathes and fidgets on its own rhythm.
  const seed = Math.random() * 100;

  const pose = (phase: number, stride: number, cycleM = 1.3, timeS = 0): void => {
    const s = clamp01(stride);
    const t = timeS + seed;
    const a = phase * Math.PI * 2;
    // A boot sweeps back under the body for the stance share of the cycle while the body moves on.
    const stepM = cycleM * STANCE * s;
    const liftM = 0.11 * s;
    // The body is lowest as each heel strikes and highest over a straight leg: two bobs a cycle.
    const bob = -0.022 * s * (0.5 + 0.5 * Math.cos(2 * a)) - 0.008 * s;
    // Standing: a slow shift of weight from foot to foot, and breath.
    const shift = (1 - s) * Math.sin(t * 0.37) * 0.018;
    const breath = Math.sin(t * 1.7);
    bones.pelvis.position.set(Math.sin(a) * 0.022 * s + shift, pelvisY + bob + breath * 0.003 * (1 - s), 0);
    bones.pelvis.rotation.set(0.015 * s, Math.sin(a) * 0.09 * s, -Math.sin(a) * 0.035 * s + shift * 0.8);
    bones.spine.rotation.set(breath * 0.012 * (1 - s), -Math.sin(a) * 0.07 * s, Math.sin(a) * 0.02 * s);
    bones.chest.rotation.set(breath * 0.01, -Math.sin(a) * 0.05 * s, 0);
    // The head holds the horizon while the body turns under it, and looks about when standing.
    const look = (1 - s) * (Math.sin(t * 0.21) * 0.35 + Math.sin(t * 0.53) * 0.12);
    bones.head.rotation.set(-0.05 * s + Math.sin(t * 0.17) * 0.06 * (1 - s), -(bones.pelvis.rotation.y + bones.spine.rotation.y + bones.chest.rotation.y) * 0.8 + look, 0);

    const hipDrop = hipY + bob - ankleY;
    for (const side of ['L', 'R'] as const) {
      const offset = side === 'L' ? 0 : 0.5;
      // Phase 0: the left heel strikes.
      const foot = footAt(phase + offset, stepM, liftM);
      // Standing, the weight leg is straight and the other bends a little.
      const rest = (side === 'L' ? 1 : -1) * shift * 1.6;
      const legs = legAngles(foot.ahead, hipDrop - foot.lift - Math.max(0, rest));
      // The pelvis turns and tilts; the thigh undoes that so the boot lands where it was aimed.
      bones[`hip${side}`].rotation.set(legs.hip - bones.pelvis.rotation.x, 0, (side === 'L' ? -1 : 1) * 0.02);
      bones[`knee${side}`].rotation.set(legs.knee, 0, 0);
      // The boot meets the ground flat, rolls from heel to toe, and points its toe up in the swing.
      bones[`ankle${side}`].rotation.set(-(legs.hip + legs.knee) + foot.pitch * s, 0, 0);

      // Arms swing against the legs: the left arm forward as the right leg is.
      const opposite = footAt(phase + offset + 0.5, 1, 0).ahead;
      const swing = opposite * 0.42 * s;
      bones[`shoulder${side}`].rotation.set(-0.62 - swing + breath * 0.008, 0, (side === 'L' ? 1 : -1) * (0.12 + 0.02 * s));
      // The elbow bends more as the arm comes forward.
      bones[`elbow${side}`].rotation.set(-0.5 - Math.max(0, swing) * 0.6 - 0.08 * s, 0, 0);
      bones[`hand${side}`].rotation.set(-0.1 * s, 0, 0);
    }
  };
  pose(0, 0);

  return {
    root,
    pose,
    dispose: () => {
      geometry.dispose();
      skinned.skeleton.dispose();
    },
  };
}

/** Step cycles per metre walked: the stride lengthens with speed, 0.9 to 1.9 m for two steps. */
export function cyclesPerMetre(speedMs: number): number {
  const strideM = Math.max(0.9, Math.min(1.9, 0.65 + 0.5 * Math.max(0, speedMs)));
  return 1 / strideM;
}
