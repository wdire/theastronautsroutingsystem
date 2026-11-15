import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import type { ModelSpec } from './modelSpecs';

/**
 * Cuts a vehicle's wheels out of its model so they can turn. The NASA files hold the six wheels as one
 * mesh (Perseverance) or as part of the whole body (the SEV): the triangles of each wheel are moved
 * into their own mesh under a pivot at the hub, named `wheel-<n>`, with the radius in userData.
 * Works on the loaded model before it is cloned, so every copy gets turning wheels.
 */
export async function separateWheels(root: Group, spec: NonNullable<ModelSpec['wheels']>): Promise<void> {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const sources: Mesh[] = [];
  if ('node' in spec) {
    root.getObjectByName(spec.node)?.traverse((o) => {
      if ((o as Mesh).isMesh) sources.push(o as Mesh);
    });
  } else {
    root.traverse((o) => {
      if ((o as Mesh).isMesh) sources.push(o as Mesh);
    });
  }
  if (sources.length === 0) return;

  // Triangle centroids in the root's frame, per source mesh.
  const v = new Vector3();
  const centroids = sources.map((mesh) => {
    const m = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const tris = (index ? index.count : pos.count) / 3;
    const out = new Float32Array(tris * 3);
    for (let t = 0; t < tris; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(m);
        out[t * 3] = (out[t * 3] ?? 0) + v.x / 3;
        out[t * 3 + 1] = (out[t * 3 + 1] ?? 0) + v.y / 3;
        out[t * 3 + 2] = (out[t * 3 + 2] ?? 0) + v.z / 3;
      }
    }
    return out;
  });

  let centres: Vector3[];
  if ('at' in spec) {
    centres = spec.at.map(([x, y, z]) => new Vector3(x, y, z));
  } else {
    // A few rounds of k-means over the wheel triangles, seeded at the corners and middles of the set.
    const all: Vector3[] = [];
    for (const c of centroids) for (let t = 0; t < c.length; t += 3) all.push(new Vector3(c[t], c[t + 1], c[t + 2]));
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of all) {
      min.min(p);
      max.max(p);
    }
    const perSide = Math.max(1, Math.round(spec.count / 2));
    centres = [];
    for (const x of [min.x, max.x]) for (let i = 0; i < perSide; i += 1) centres.push(new Vector3(x, spec.radius, min.z + ((max.z - min.z) * (i + 0.5)) / perSide));
    for (let round = 0; round < 8; round += 1) {
      const sum = centres.map(() => new Vector3());
      const n = centres.map(() => 0);
      for (const p of all) {
        let best = 0;
        for (let c = 1; c < centres.length; c += 1) if (p.distanceToSquared(centres[c]!) < p.distanceToSquared(centres[best]!)) best = c;
        sum[best]!.add(p);
        n[best] = (n[best] ?? 0) + 1;
      }
      centres.forEach((c, i) => {
        if ((n[i] ?? 0) > 0) c.copy(sum[i]!.divideScalar(n[i]!));
      });
    }
    // The hub sits a radius above the ground, wherever the mass of the tread put the centroid.
    for (const c of centres) c.y = spec.radius;
  }

  // In cylinder mode a triangle inside a wheel's cylinder is not enough: the fender, the strut and the
  // steering arm reach into it too, and turned with the tyre they spun like a handle. Only whole parts
  // (triangles joined by shared corners) that lie inside one cylinder are cut out.
  // Which connected part each triangle belongs to depends on the mesh alone: worked out once, a mesh per task,
  // so loading a model never holds a frame for long.
  const partsOfMesh: Int32Array[] = [];
  if ('at' in spec) {
    for (const mesh of sources) {
      await nextTask();
      partsOfMesh.push(connectedParts(mesh));
    }
    await nextTask();
  }
  let partOf = 'at' in spec ? sources.map((mesh, s) => wholePartsInside(mesh, partsOfMesh[s]!, toRoot, centres, spec.radius * 1.1, spec.halfWidth * 1.2)) : null;
  // The hubs given are a guess: a wheel turned about a point a few centimetres off its true axle wobbles.
  // The axle is put at the middle of the tyre found, and the parts are chosen again about it.
  const radii = centres.map(() => spec.radius);
  // A wheel node's triangles go to the nearest hub; its hubs are recentred the same way.
  const byNode = 'node' in spec ? centroids.map((c) => {
    const out = new Int32Array(c.length / 3);
    for (let t = 0; t < out.length; t += 1) {
      let best = 0;
      for (let k = 1; k < centres.length; k += 1) {
        const a = centres[k]!;
        const b = centres[best]!;
        if (((c[t * 3] ?? 0) - a.x) ** 2 + ((c[t * 3 + 2] ?? 0) - a.z) ** 2 < ((c[t * 3] ?? 0) - b.x) ** 2 + ((c[t * 3 + 2] ?? 0) - b.z) ** 2) best = k;
      }
      out[t] = best;
    }
    return out;
  }) : null;
  const found = partOf ?? byNode;
  if (found) {
    const box = centres.map(() => ({ y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }));
    sources.forEach((mesh, s) => {
      const parts = found[s]!;
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const m = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
      for (let t = 0; t < parts.length; t += 1) {
        const w = parts[t]!;
        if (w < 0) continue;
        for (let k = 0; k < 3; k += 1) {
          v.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(m);
          const b = box[w]!;
          b.y0 = Math.min(b.y0, v.y);
          b.y1 = Math.max(b.y1, v.y);
          b.z0 = Math.min(b.z0, v.z);
          b.z1 = Math.max(b.z1, v.z);
        }
      }
    });
    box.forEach((b, w) => {
      if (!Number.isFinite(b.y0)) return;
      // Fore and aft the tyre is the widest thing in the cylinder; upward, a fender piece may reach higher.
      // So the radius is read along the ground, and the axle stands that far above the tyre's lowest point.
      radii[w] = (b.z1 - b.z0) / 2;
      centres[w]!.z = (b.z0 + b.z1) / 2;
      centres[w]!.y = b.y0 + radii[w]!;
    });
    const r = Math.max(...radii);
    await nextTask();
    if (partOf) partOf = sources.map((mesh, s) => wholePartsInside(mesh, partsOfMesh[s]!, toRoot, centres, r * 1.06, spec.halfWidth * 1.2));
  }

  const wheelOf = (x: number, y: number, z: number): number => {
    if ('node' in spec) {
      // Every triangle of the wheel node belongs to its nearest hub.
      let best = 0;
      for (let k = 1; k < centres.length; k += 1) {
        const a = centres[k]!;
        const b = centres[best]!;
        if ((x - a.x) ** 2 + (z - a.z) ** 2 < (x - b.x) ** 2 + (z - b.z) ** 2) best = k;
      }
      return best;
    }
    // Elsewhere only what lies inside a wheel's cylinder: the tyre and hub, not the fender over it.
    for (let w = 0; w < centres.length; w += 1) {
      const c = centres[w]!;
      if (Math.abs(x - c.x) < spec.halfWidth && Math.hypot(y - c.y, z - c.z) < spec.radius * 1.04) return w;
    }
    return -1;
  };

  const pivots = centres.map((c, i) => {
    const pivot = new Group();
    pivot.name = `wheel-${i}`;
    pivot.position.copy(c);
    pivot.userData.radius = radii[i] ?? spec.radius;
    root.add(pivot);
    return pivot;
  });

  sources.forEach((mesh, s) => {
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const pos = geometry.getAttribute('position');
    const c = centroids[s]!;
    const tris = c.length / 3;
    const kept: number[] = [];
    const moved: number[][] = centres.map(() => []);
    const parts = partOf?.[s];
    for (let t = 0; t < tris; t += 1) {
      const w = parts ? (parts[t] ?? -1) : wheelOf(c[t * 3] ?? 0, c[t * 3 + 1] ?? 0, c[t * 3 + 2] ?? 0);
      const target = w >= 0 ? moved[w]! : kept;
      for (let k = 0; k < 3; k += 1) target.push(index ? index.getX(t * 3 + k) : t * 3 + k);
    }
    if (kept.length === tris * 3) return;
    const relative = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    const withIndex = (list: number[]): BufferGeometry => {
      const g = new BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
      g.setIndex(new BufferAttribute(pos.count > 65_535 ? new Uint32Array(list) : new Uint16Array(list), 1));
      // The whole mesh's sphere holds any part of it: a pass over every point per wheel cost a tenth of a second.
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      g.boundingSphere = geometry.boundingSphere?.clone() ?? null;
      return g;
    };
    moved.forEach((list, w) => {
      if (list.length === 0) return;
      const part = new Mesh(withIndex(list), mesh.material);
      part.name = `${mesh.name}-wheel-${w}`;
      part.castShadow = mesh.castShadow;
      part.receiveShadow = mesh.receiveShadow;
      // The part keeps its place: its transform is the source mesh's, seen from the hub.
      new Matrix4().makeTranslation(-centres[w]!.x, -centres[w]!.y, -centres[w]!.z).multiply(relative).decompose(part.position, part.quaternion, part.scale);
      pivots[w]!.add(part);
    });
    if (kept.length > 0) {
      mesh.geometry = withIndex(kept);
    } else {
      mesh.visible = false;
    }
  });
}

/** The turning wheels of a model or its clone. */
export function wheelsOf(root: Object3D): { pivot: Object3D; radius: number }[] {
  const out: { pivot: Object3D; radius: number }[] = [];
  root.traverse((o) => {
    if (/^wheel-\d+$/.test(o.name)) out.push({ pivot: o, radius: (o.userData.radius as number | undefined) ?? 0.3 });
  });
  return out;
}

/** Rolls wheels on by a distance travelled forward, m (negative backward). */
export function rollWheels(wheels: readonly { pivot: Object3D; radius: number }[], distanceM: number): void {
  // Front is -z: a wheel rolling forward turns its top toward -z, a negative turn about x.
  for (const w of wheels) w.pivot.rotation.x -= distanceM / w.radius;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * For each triangle of a mesh, the connected part it belongs to (triangles joined by shared corners). Corners
 * are joined by position, since exporters split vertices along seams.
 */
function connectedParts(mesh: Mesh): Int32Array {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const tris = (index ? index.count : pos.count) / 3;
  const corner = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // Weld by position, rounded to 0.1 mm, through a numeric hash table: a string key for every corner cost
  // most of a second on the larger models, in one frame, as Rover View opened.
  const count = pos.count;
  const qx = new Float64Array(count);
  const qy = new Float64Array(count);
  const qz = new Float64Array(count);
  let cap = 1;
  while (cap < count * 2) cap <<= 1;
  const slotVertex = new Int32Array(cap).fill(-1);
  const slotId = new Int32Array(cap);
  const weld = new Int32Array(count);
  let parts = 0;
  for (let i = 0; i < count; i += 1) {
    const x = Math.round(pos.getX(i) * 1e4);
    const y = Math.round(pos.getY(i) * 1e4);
    const z = Math.round(pos.getZ(i) * 1e4);
    qx[i] = x;
    qy[i] = y;
    qz[i] = z;
    let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) & (cap - 1);
    for (;;) {
      const r = slotVertex[h]!;
      if (r < 0) {
        slotVertex[h] = i;
        slotId[h] = parts;
        weld[i] = parts;
        parts += 1;
        break;
      }
      if (qx[r] === x && qy[r] === y && qz[r] === z) {
        weld[i] = slotId[h]!;
        break;
      }
      h = (h + 1) & (cap - 1);
    }
  }
  const parent = new Int32Array(parts);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let t = 0; t < tris; t += 1) {
    const a = find(weld[corner(t, 0)]!);
    parent[find(weld[corner(t, 1)]!)] = a;
    parent[find(weld[corner(t, 2)]!)] = a;
  }
  const out = new Int32Array(tris);
  for (let t = 0; t < tris; t += 1) out[t] = find(weld[corner(t, 0)]!);
  return out;
}

/** For each triangle of a mesh, the wheel whose cylinder holds the whole connected part it belongs to, or -1. */
function wholePartsInside(mesh: Mesh, partOfTri: Int32Array, toRoot: Matrix4, centres: readonly Vector3[], radius: number, halfWidth: number): Int32Array {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const tris = partOfTri.length;
  const corner = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  // Which cylinder each vertex lies in (-1 none), and per part whether every vertex agrees.
  const m = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
  const v = new Vector3();
  const partWheel = new Map<number, number>();
  for (let t = 0; t < tris; t += 1) {
    const root = partOfTri[t]!;
    if (partWheel.get(root) === -2) continue;
    for (let k = 0; k < 3; k += 1) {
      v.fromBufferAttribute(pos, corner(t, k)).applyMatrix4(m);
      let inside = -1;
      for (let w = 0; w < centres.length; w += 1) {
        const c = centres[w]!;
        if (Math.abs(v.x - c.x) < halfWidth && Math.hypot(v.y - c.y, v.z - c.z) < radius) {
          inside = w;
          break;
        }
      }
      const was = partWheel.get(root);
      // -2: the part reaches outside every cylinder, or spans two; it stays with the body.
      if (inside < 0 || (was !== undefined && was !== inside)) {
        partWheel.set(root, -2);
        break;
      }
      partWheel.set(root, inside);
    }
  }
  const out = new Int32Array(tris);
  for (let t = 0; t < tris; t += 1) {
    const w = partWheel.get(partOfTri[t]!) ?? -1;
    out[t] = w >= 0 ? w : -1;
  }
  return out;
}
