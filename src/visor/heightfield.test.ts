import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { fieldHeightAt, fieldIndices, type HeightField } from './heightfield';

function roughField(n: number, step: number): HeightField {
  const heights = new Float32Array(n * n);
  for (let i = 0; i < heights.length; i += 1) heights[i] = Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453);
  for (let i = 0; i < heights.length; i += 1) heights[i] = (heights[i] ?? 0) * 8;
  return { n, x0: -((n - 1) * step) / 2, z0: -((n - 1) * step) / 2, step, heights };
}

function meshOf(f: HeightField): Mesh {
  const pos = new Float32Array(f.n * f.n * 3);
  for (let iz = 0; iz < f.n; iz += 1) {
    for (let ix = 0; ix < f.n; ix += 1) {
      const i = iz * f.n + ix;
      pos[i * 3] = f.x0 + ix * f.step;
      pos[i * 3 + 1] = f.heights[i] ?? 0;
      pos[i * 3 + 2] = f.z0 + iz * f.step;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(fieldIndices(f.n), 1));
  return new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
}

describe('height field', () => {
  it('returns exactly the height of the drawn triangles, as a ray cast on the mesh finds it', () => {
    const f = roughField(9, 6);
    const mesh = meshOf(f);
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster();
    let checked = 0;
    for (let k = 0; k < 400; k += 1) {
      const x = f.x0 + ((k * 37) % 479) / 10;
      const z = f.z0 + ((k * 91) % 477) / 10;
      ray.set(new Vector3(x, 1000, z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      const h = fieldHeightAt(f, x, z);
      if (!hit || h === null) continue;
      expect(Math.abs(hit.point.y - h)).toBeLessThan(1e-3);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('is exact at samples and null outside the field', () => {
    const f = roughField(5, 10);
    expect(fieldHeightAt(f, f.x0, f.z0)).toBeCloseTo(f.heights[0] ?? 0, 5);
    expect(fieldHeightAt(f, f.x0 + 40, f.z0 + 40)).toBeCloseTo(f.heights[24] ?? 0, 5);
    expect(fieldHeightAt(f, f.x0 - 0.01, f.z0)).toBeNull();
    expect(fieldHeightAt(f, 0, f.z0 + 40.01)).toBeNull();
  });
});
