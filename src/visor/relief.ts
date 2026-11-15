/**
 * The relief the elevation data is too coarse to hold. Where the ground under the viewer comes from a
 * 200 m model, the plain between two samples is drawn dead flat; Mars is never flat at that scale. This
 * adds what the orbiters could not resolve, and only that: rolling ground, small impact craters with
 * rims and blocky ejecta, transverse aeolian ridges in the low ground, and knobs of exposed rock. Every
 * feature is cut off above the resolution of the data under it, so where HiRISE's 1 m model is drawn only
 * the last few centimetres are invented, and where 200 m data is drawn everything below about 600 m is.
 *
 * Everything is a pure function of a point's place on Mars (not of the view), so the same crater is in
 * the same place on every visit and every ground layer agrees about it. The Rover View caption says
 * relief like this is drawn in, not measured.
 */
import { hash } from './rockField';

/** Metres per degree of latitude on Mars. */
const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;

/** A point's place in metres on a plane that is the same for every visit: x east, z south. */
export function planetMetres(lon: number, lat: number): [number, number] {
  return [lon * M_PER_DEG * Math.cos((lat * Math.PI) / 180), -lat * M_PER_DEG];
}

/* ---- gradient noise ---- */

const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(hash(i, 7, 1301) * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i += 1) PERM[i] = p[i & 255]!;
}
const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
const GZ = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];

/** Perlin noise in two dimensions, about -1 to 1. */
export function noise2(x: number, z: number): number {
  const xf = Math.floor(x);
  const zf = Math.floor(z);
  const X = xf & 255;
  const Z = zf & 255;
  const fx = x - xf;
  const fz = z - zf;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const g = (h: number, dx: number, dz: number) => GX[h & 7]! * dx + GZ[h & 7]! * dz;
  const aa = PERM[PERM[X]! + Z]!;
  const ba = PERM[PERM[X + 1]! + Z]!;
  const ab = PERM[PERM[X]! + Z + 1]!;
  const bb = PERM[PERM[X + 1]! + Z + 1]!;
  const x1 = g(aa, fx, fz) + (g(ba, fx - 1, fz) - g(aa, fx, fz)) * u;
  const x2 = g(ab, fx, fz - 1) + (g(bb, fx - 1, fz - 1) - g(ab, fx, fz - 1)) * u;
  return (x1 + (x2 - x1) * v) * 0.72;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/* ---- the spectrum ---- */

/** Wavelengths of the rolling ground, m, longest first; each octave is turned against the last. */
const OCTAVES = [1600, 800, 400, 200, 100, 50, 25, 12.5, 6.25, 3.1, 1.6, 0.8];
const ROT = OCTAVES.map((_, k) => [Math.cos(0.65 * k + 0.3), Math.sin(0.65 * k + 0.3)] as const);
/** Height of an octave, m: rough ground on Mars has a Hurst exponent near 0.8. */
const amp = (lambda: number) => 0.055 * lambda ** 0.82;

/** Small craters, by size class: the cell each is placed in, the chance a cell holds one, and the diameters. */
const CRATERS = [
  { cellM: 22, chance: 0.4, minD: 1.6, maxD: 7, salt: 11 },
  { cellM: 90, chance: 0.55, minD: 7, maxD: 34, salt: 23 },
  { cellM: 420, chance: 0.5, minD: 30, maxD: 150, salt: 37 },
] as const;

/** Ripple crests of a transverse aeolian ridge field, m apart. */
const TAR_M = 32;

export interface ReliefSample {
  /** Height to add, m. */
  h: number;
  /** 0 to 1: loose dark sand (crater floors, ridge fields, hollows). */
  sand: number;
  /** 0 to 1: exposed rock and blocks (fresh rims and ejecta, knobs). */
  rock: number;
}

/**
 * What the data leaves out at a point. `minLambdaM` is the finest feature the layer can draw (a few of its
 * triangles); `cutoffM` the finest the data under it already holds. Only features between the two are added.
 */
export function reliefAt(X: number, Z: number, minLambdaM: number, cutoffM: number, out: ReliefSample): ReliefSample {
  out.h = 0;
  out.sand = 0;
  out.rock = 0;
  if (cutoffM <= minLambdaM * 0.7) return out;
  const band = (lambda: number) => (1 - smooth(cutoffM * 0.5, cutoffM, lambda)) * smooth(minLambdaM * 0.7, minLambdaM * 1.4, lambda);

  // Regions differ: smooth plains next to knobbly ground. A slow field sets how rough each one is.
  const region = noise2(X / 2600 + 31.7, Z / 2600 - 8.2);
  const rough = 0.35 + 1.4 * smooth(-0.45, 0.5, region);
  // A gentle warp, so features are not laid out on the noise's own grid.
  const wx = X + noise2(X / 900, Z / 900) * 140;
  const wz = Z + noise2(X / 900 + 5.2, Z / 900 + 1.3) * 140;

  let h = 0;
  let broad = 0;
  for (let k = 0; k < OCTAVES.length; k += 1) {
    const lambda = OCTAVES[k]!;
    const w = band(lambda);
    if (w <= 0.001) continue;
    const [c, s] = ROT[k]!;
    const px = (wx * c - wz * s) / lambda;
    const pz = (wx * s + wz * c) / lambda;
    let n = noise2(px + k * 13.1, pz - k * 7.7);
    // Between 50 and 400 m some of the relief is ridged: knobs and low ridges of rock rather than swell.
    if (lambda >= 50 && lambda <= 400) {
      const ridge = 1 - Math.abs(n);
      n = n * 0.55 + (ridge * ridge - 0.45) * 0.9 * rough;
    }
    const a = amp(lambda) * w * (lambda >= 25 ? rough : 0.7 + 0.3 * rough);
    h += n * a;
    if (lambda >= 100) broad += n * a;
  }
  // Layered rock weathers into benches: where rock stands out, the finer relief steps in ledges.
  const ledge = smooth(0.2, 0.75, noise2(X / 520 - 11.4, Z / 520 + 6.6)) * rough;
  if (ledge > 0.02 && band(25) > 0.05) {
    const stepM = 0.55;
    const q = h / stepM;
    const f = q - Math.floor(q);
    // Flat treads and short risers, the riser softened so it is not a knife edge.
    const stepped = (Math.floor(q) + smooth(0.72, 0.98, f)) * stepM;
    h += (stepped - h) * Math.min(1, ledge * 1.4) * band(25);
    out.rock = Math.max(out.rock, ledge * 0.85);
  }
  out.h = h;
  // Sand gathers in the hollows, rock stands out on the rises.
  out.sand = smooth(0.2, -1.6, broad) * 0.6;
  out.rock = Math.max(out.rock, smooth(0.6, 2.4, broad) * 0.5 * rough);
  // Rock-strewn stretches and bare ones alternate over a few hundred metres, as in every rover panorama.
  out.rock = Math.max(out.rock, smooth(0.05, 0.5, noise2(X / 340 + 17.3, Z / 340 - 4.1)) * 0.42 * rough);

  // Transverse aeolian ridges: straight, evenly spaced sand crests in some of the low ground.
  const wt = band(TAR_M);
  if (wt > 0.01) {
    const mask = smooth(0.15, 0.45, noise2(X / 1900 - 3.3, Z / 1900 + 9.1)) * smooth(0.6, -0.8, broad);
    if (mask > 0.01) {
      const angle = 0.6 + noise2(X / 6000, Z / 6000) * 0.5;
      const u = (wx * Math.cos(angle) + wz * Math.sin(angle)) / TAR_M + noise2(wx / 160, wz / 160) * 0.35;
      const f = u - Math.floor(u);
      // A crest steeper on its lee side.
      const crest = f < 0.62 ? smooth(0, 0.62, f) : 1 - smooth(0.62, 1, f);
      out.h += (crest - 0.4) * 1.1 * mask * wt;
      out.sand = Math.max(out.sand, mask * 0.9);
      out.rock *= 1 - mask;
    }
  }

  // Craters: a bowl, a raised rim, ejecta thinning outward; fresh ones deep and blocky, old ones filled with sand.
  for (const cls of CRATERS) {
    // A class is skipped when none of its craters could be drawn here; each crater is weighed by its own size below.
    if (cls.minD > cutoffM * 0.9 || cls.maxD < minLambdaM * 0.6) continue;
    const ix0 = Math.floor(X / cls.cellM);
    const iz0 = Math.floor(Z / cls.cellM);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const ix = ix0 + dx;
        const iz = iz0 + dz;
        if (hash(ix, iz, cls.salt) > cls.chance) continue;
        const D = cls.minD + (cls.maxD - cls.minD) * hash(ix, iz, cls.salt + 1) ** 2.2;
        // Larger than the data resolves: it would be in the data already. Smaller than the layer's triangles: not drawable.
        const weight = (1 - smooth(cutoffM * 0.35, cutoffM * 0.9, D)) * smooth(minLambdaM * 0.6, minLambdaM * 1.2, D);
        if (weight <= 0.01) continue;
        const R = D / 2;
        const cx = (ix + 0.15 + 0.7 * hash(ix, iz, cls.salt + 2)) * cls.cellM;
        const cz = (iz + 0.15 + 0.7 * hash(ix, iz, cls.salt + 3)) * cls.cellM;
        const r = Math.hypot(X - cx, Z - cz) / R;
        if (r > 3) continue;
        const fresh = hash(ix, iz, cls.salt + 4) ** 1.5;
        const depth = D * (0.05 + 0.13 * fresh);
        const rim = D * (0.008 + 0.034 * fresh);
        const fill = 0.15 + 0.6 * (1 - fresh);
        let dh: number;
        if (r < 1) {
          // Parabolic bowl, its floor flattened where sand and dust have filled it.
          dh = Math.max(depth * (r * r - 1), -depth * (1 - fill)) + rim * r ** 6;
          out.sand = Math.max(out.sand, (1 - smooth(0.45, 0.95, r)) * (0.5 + 0.5 * (1 - fresh)) * weight);
        } else {
          dh = rim * r ** -3.2 * (1 - smooth(2.2, 3, r));
          out.rock = Math.max(out.rock, fresh * (1 - smooth(1, 1.5 + fresh, r)) * weight * (D > 4 ? 1 : 0.5));
        }
        out.h += dh * weight;
      }
    }
  }
  return out;
}

/**
 * The finest feature the package's elevation already holds, m, from the zoom of its source there:
 * 14 is HiRISE read at 5 m, 12 and 13 CTX at 20 m, 6 to 11 HRSC and MOLA at 200 m, below that MOLA.
 */
export function cutoffForSourceZoom(zoom: number): number {
  if (zoom >= 14) return 16;
  if (zoom >= 12) return 60;
  if (zoom >= 6) return 600;
  return 1400;
}

/**
 * Where HiRISE's own 1 m model is drawn: only the last few metres are left to invent. A stereo model posted
 * at 1 m resolves about three posts, and smooths more on bland ground, so hummocks under 6 m are added.
 */
export const HIRISE_CUTOFF_M = 6;
