import { BufferAttribute, Color, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Scene } from 'three';
import { ROCK_CLASSES, hash, rocksInCell, type RockClass } from './rockField';

type Shape = 'lumpy' | 'platy' | 'block';

/** A smooth bump field over the unit sphere: a few broad lobes, so rocks are rounded, not spiky. */
function lobes(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const kx = hash(i, seed, 21) * 2 - 1;
    const ky = hash(i, seed, 22) * 2 - 1;
    const kz = hash(i, seed, 23) * 2 - 1;
    const f = 1.6 + hash(i, seed, 24) * 1.8;
    sum += Math.sin((x * kx + y * ky + z * kz) * f + hash(i, seed, 25) * 6.283) * (0.5 / (i + 1));
  }
  return sum;
}

/** A unit rock: an icosphere pushed out of shape, dusty on the faces that look up. */
function rockGeometry(shape: Shape, seed: number): BufferGeometry {
  let g: BufferGeometry = new IcosahedronGeometry(0.5, shape === 'block' ? 1 : 2);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  // Planes that slice a block into flat faces.
  const cuts = shape === 'block' ? Array.from({ length: 6 }, (_, i) => ({ n: new Vector3(hash(i, seed, 1) - 0.5, hash(i, seed, 2) - 0.35, hash(i, seed, 3) - 0.5).normalize(), d: 0.26 + hash(i, seed, 4) * 0.16 })) : [];
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    if (shape === 'block') {
      for (const c of cuts) {
        const over = v.dot(c.n) - c.d;
        if (over > 0) v.addScaledVector(c.n, -over);
      }
    } else {
      v.copy(dir).multiplyScalar(0.5 * (1 + lobes(dir.x, dir.y, dir.z, seed) * 0.2));
    }
    if (shape === 'platy') v.y *= 0.42;
    else if (shape === 'lumpy') v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  if (shape === 'block') g = g.toNonIndexed();
  g.computeVertexNormals();
  // Vertex colours: rock below, dust settled on top.
  const normal = g.getAttribute('normal');
  const colours = new Float32Array(normal.count * 3);
  // Dark basalt, with the same butterscotch dust as the ground on the faces that look up.
  const rock = new Color(0.2, 0.15, 0.125);
  const dust = new Color(0.52, 0.36, 0.24);
  const c = new Color();
  for (let i = 0; i < normal.count; i += 1) {
    const up = Math.max(0, Math.min(1, (normal.getY(i) - 0.25) / 0.6));
    c.copy(rock).lerp(dust, up * up * 0.6);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  return g;
}

interface Batch {
  cls: RockClass;
  shape: Shape;
  mesh: InstancedMesh;
  /** Which rocks of the class this batch draws: those whose variant falls in [from, to). */
  from: number;
  to: number;
}

const CAPACITY: Record<RockClass['name'], number> = { pebble: 16_000, cobble: 11_000, boulder: 1_400 };

/**
 * The rocks around the viewer, as instanced meshes. `update` re-places them when the viewer has
 * crossed into a new cell; it is cheap enough to call every frame.
 */
export function createRocks(scene: Scene, heightAt: (x: number, z: number) => number | null, slopeAt: (x: number, z: number) => number) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const flat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true });
  const layout: [RockClass['name'], Shape, number, number][] = [
    ['pebble', 'lumpy', 0, 0.6],
    ['pebble', 'platy', 0.6, 1],
    ['cobble', 'lumpy', 0, 0.5],
    ['cobble', 'block', 0.5, 1],
    ['boulder', 'block', 0, 1],
  ];
  const batches: Batch[] = layout.map(([name, shape, from, to], i) => {
    const cls = ROCK_CLASSES.find((c) => c.name === name) ?? ROCK_CLASSES[0]!;
    const mesh = new InstancedMesh(rockGeometry(shape, 11 + i * 7), shape === 'block' ? flat : material, Math.ceil(CAPACITY[name] * (to - from) * 1.15));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = name !== 'pebble';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return { cls, shape, mesh, from, to };
  });

  const lastCell = new Map<RockClass['name'], string>();
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const tint = new Color();
  const UP = new Vector3(0, 1, 0);
  let lowQuality = false;

  const place = (cls: RockClass, cx: number, cz: number) => {
    const mine = batches.filter((b) => b.cls === cls);
    const counts = mine.map(() => 0);
    const span = Math.ceil(cls.radiusM / cls.cellM);
    const ix0 = Math.floor(cx / cls.cellM);
    const iz0 = Math.floor(cz / cls.cellM);
    for (let dz = -span; dz <= span; dz += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        if (dx * dx + dz * dz > span * span) continue;
        const ix = ix0 + dx;
        const iz = iz0 + dz;
        const mx = (ix + 0.5) * cls.cellM;
        const mz = (iz + 0.5) * cls.cellM;
        if (heightAt(mx, mz) === null) continue;
        for (const rock of rocksInCell(cls, ix, iz, slopeAt(mx, mz))) {
          const y = heightAt(rock.x, rock.z);
          if (y === null) continue;
          const b = mine.findIndex((batch) => rock.variant >= batch.from && rock.variant < batch.to);
          const batch = mine[b];
          if (!batch || (counts[b] ?? 0) >= batch.mesh.instanceMatrix.count) continue;
          const height = rock.size * (batch.shape === 'platy' ? 0.42 : batch.shape === 'lumpy' ? 0.72 : 0.8);
          p.set(rock.x, y + height * (0.5 - cls.sink), rock.z);
          q.setFromAxisAngle(UP, rock.yaw);
          s.set(rock.size, rock.size, rock.size * (0.75 + rock.variant * 0.5));
          m.compose(p, q, s);
          batch.mesh.setMatrixAt(counts[b] ?? 0, m);
          const shade = 0.72 + ((rock.variant * 7.13) % 1) * 0.5;
          batch.mesh.setColorAt(counts[b] ?? 0, tint.setRGB(shade, shade * 0.98, shade * 0.96));
          counts[b] = (counts[b] ?? 0) + 1;
        }
      }
    }
    mine.forEach((batch, i) => {
      batch.mesh.count = counts[i] ?? 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    });
  };

  return {
    update(x: number, z: number, force = false) {
      for (const cls of ROCK_CLASSES) {
        if (lowQuality && cls.name === 'pebble') continue;
        // Re-place a class only after moving a good part of its cell: the far edge of its disc is out of sight anyway.
        const key = `${Math.floor(x / (cls.cellM * 2))},${Math.floor(z / (cls.cellM * 2))}`;
        if (!force && lastCell.get(cls.name) === key) continue;
        lastCell.set(cls.name, key);
        place(cls, x, z);
      }
    },
    setLowQuality(low: boolean) {
      lowQuality = low;
      for (const b of batches) {
        if (b.cls.name === 'pebble') b.mesh.visible = !low;
        if (b.cls.name === 'cobble') b.mesh.castShadow = !low;
      }
      if (!low) lastCell.clear();
    },
    dispose() {
      for (const b of batches) {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.dispose();
      }
      material.dispose();
      flat.dispose();
    },
  };
}
