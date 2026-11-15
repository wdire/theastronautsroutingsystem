/**
 * A square height field drawn as triangles, and the height of that drawn surface at any point.
 * Each cell is split along the diagonal from (0,1) to (1,0), the way three.js PlaneGeometry does,
 * so what the camera stands on is exactly what is drawn, not a smoother blend of it.
 */
export interface HeightField {
  /** Samples per side. */
  n: number;
  /** Local position of sample (0,0): the north-west corner. */
  x0: number;
  z0: number;
  /** Distance between samples, m. */
  step: number;
  /** Row-major heights, row 0 at z0. */
  heights: Float32Array;
}

export function fieldHeightAt(f: HeightField, x: number, z: number): number | null {
  const gx = (x - f.x0) / f.step;
  const gz = (z - f.z0) / f.step;
  if (gx < 0 || gz < 0 || gx > f.n - 1 || gz > f.n - 1) return null;
  const ix = Math.min(f.n - 2, Math.floor(gx));
  const iz = Math.min(f.n - 2, Math.floor(gz));
  const u = gx - ix;
  const v = gz - iz;
  const a = f.heights[iz * f.n + ix] ?? 0;
  const d = f.heights[iz * f.n + ix + 1] ?? 0;
  const b = f.heights[(iz + 1) * f.n + ix] ?? 0;
  const c = f.heights[(iz + 1) * f.n + ix + 1] ?? 0;
  // a (0,0), d (1,0), b (0,1), c (1,1); the diagonal runs b to d.
  if (u + v <= 1) return a + (d - a) * u + (b - a) * v;
  return c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

/** Triangle indices for an n by n field, matching fieldHeightAt’s split. */
export function fieldIndices(n: number): Uint32Array {
  const out = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < n - 1; iz += 1) {
    for (let ix = 0; ix < n - 1; ix += 1) {
      const a = iz * n + ix;
      const d = a + 1;
      const b = a + n;
      const c = b + 1;
      out[k++] = a;
      out[k++] = b;
      out[k++] = d;
      out[k++] = b;
      out[k++] = c;
      out[k++] = d;
    }
  }
  return out;
}

/** Slope of the drawn surface at a point, degrees, from the two triangle edges under it. */
export function fieldSlopeAt(f: HeightField, x: number, z: number): number {
  const e = f.step * 0.5;
  const h = (px: number, pz: number) => fieldHeightAt(f, px, pz);
  const hx0 = h(x - e, z);
  const hx1 = h(x + e, z);
  const hz0 = h(x, z - e);
  const hz1 = h(x, z + e);
  if (hx0 === null || hx1 === null || hz0 === null || hz1 === null) return 0;
  return (Math.atan(Math.hypot((hx1 - hx0) / (2 * e), (hz1 - hz0) / (2 * e))) * 180) / Math.PI;
}

/**
 * Normals of a regular height grid from its central differences (one-sided at the edges). The same surface
 * three.js would shade, at a fraction of the cost of its general per-triangle pass over a quarter of a million
 * points.
 */
export function gridNormals(heights: Float32Array, n: number, step: number): Float32Array {
  const out = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz += 1) {
    const zl = Math.max(0, iz - 1);
    const zh = Math.min(n - 1, iz + 1);
    for (let ix = 0; ix < n; ix += 1) {
      const xl = Math.max(0, ix - 1);
      const xh = Math.min(n - 1, ix + 1);
      const dx = ((heights[iz * n + xh] ?? 0) - (heights[iz * n + xl] ?? 0)) / ((xh - xl) * step);
      const dz = ((heights[zh * n + ix] ?? 0) - (heights[zl * n + ix] ?? 0)) / ((zh - zl) * step);
      const len = Math.hypot(dx, 1, dz);
      const o = (iz * n + ix) * 3;
      out[o] = -dx / len;
      out[o + 1] = 1 / len;
      out[o + 2] = -dz / len;
    }
  }
  return out;
}
