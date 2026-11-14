import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import type { ModelSpec } from './modelSpecs';

/**
 * Cuts a vehicle's wheels out of its model so they can turn. The NASA files hold the six wheels as one
 * mesh (Perseverance) or as part of the whole body (the SEV): the triangles of each wheel are moved
 * into their own mesh under a pivot at the hub, named `wheel-<n>`, with the radius in userData.
 * Works on the loaded model before it is cloned, so every copy gets turning wheels.
 */
export function separateWheels(root: Group, spec: NonNullable<ModelSpec['wheels']>): void {
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
    pivot.userData.radius = spec.radius;
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
    for (let t = 0; t < tris; t += 1) {
      const w = wheelOf(c[t * 3] ?? 0, c[t * 3 + 1] ?? 0, c[t * 3 + 2] ?? 0);
      const target = w >= 0 ? moved[w]! : kept;
      for (let k = 0; k < 3; k += 1) target.push(index ? index.getX(t * 3 + k) : t * 3 + k);
    }
    if (kept.length === tris * 3) return;
    const relative = new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
    const withIndex = (list: number[]): BufferGeometry => {
      const g = new BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) g.setAttribute(name, attribute);
      g.setIndex(new BufferAttribute(pos.count > 65_535 ? new Uint32Array(list) : new Uint16Array(list), 1));
      g.computeBoundingSphere();
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
