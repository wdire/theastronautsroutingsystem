/**
 * Where rocks lie. Placement is a pure function of the cell a rock is in, so the same rock is in
 * the same place every time you come back, and no list of rocks is ever stored.
 * Rocks are drawn in for a sense of scale; they are not measured.
 */
export interface RockClass {
  name: 'pebble' | 'cobble' | 'boulder';
  /** Side of a placement cell, m. */
  cellM: number;
  /** Rocks per cell on ordinary flat ground. */
  perCell: number;
  minM: number;
  maxM: number;
  /** Drawn within this distance of the viewer, m. */
  radiusM: number;
  /** Share of its own height that sits below the ground. */
  sink: number;
}

export const ROCK_CLASSES: readonly RockClass[] = [
  { name: 'pebble', cellM: 5, perCell: 9, minM: 0.05, maxM: 0.3, radiusM: 60, sink: 0.45 },
  { name: 'cobble', cellM: 12, perCell: 4, minM: 0.28, maxM: 0.9, radiusM: 200, sink: 0.42 },
  { name: 'boulder', cellM: 50, perCell: 1.6, minM: 0.9, maxM: 3, radiusM: 600, sink: 0.36 },
];

export interface Rock {
  x: number;
  z: number;
  /** Largest dimension, m. */
  size: number;
  /** Turn about the vertical, radians. */
  yaw: number;
  /** 0..1, picks the shape and the tint. */
  variant: number;
}

/** A well-mixed hash of two integers and a salt to 0..1 (three rounds of the murmur3 mixer). */
export function hash(ix: number, iz: number, salt: number): number {
  let h = 0x9e3779b9;
  for (const v of [ix | 0, iz | 0, salt | 0]) {
    let k = Math.imul(v, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise over cells, 0..1: where it is low the ground is open sand with few rocks. */
export function sandiness(x: number, z: number): number {
  const s = 90;
  const gx = x / s;
  const gz = z / s;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, 91);
  const b = hash(ix + 1, iz, 91);
  const c = hash(ix, iz + 1, 91);
  const d = hash(ix + 1, iz + 1, 91);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 0 on gentle ground, 1 on steep ground: steep ground and its foot shed more and larger rocks. */
export function slopeWeight(slopeDeg: number): number {
  const t = Math.max(0, Math.min(1, (slopeDeg - 6) / 14));
  return t * t * (3 - 2 * t);
}

/**
 * The rocks of one cell. `slopeDeg` is the slope of the ground at the cell, sampled once.
 * `keepOff` lets a caller clear rocks from a path. `rockiness` (0 to 1), where known, is how broken
 * the ground looks from orbit (see Patch.roughnessAt): rippled sand gets almost none, rubble the most.
 */
export function rocksInCell(
  cls: RockClass,
  ix: number,
  iz: number,
  slopeDeg: number,
  keepOff?: (x: number, z: number) => boolean,
  rockiness: number | null = null,
): Rock[] {
  const salt = cls.cellM * 31;
  const w = slopeWeight(slopeDeg);
  const cx = (ix + 0.5) * cls.cellM;
  const cz = (iz + 0.5) * cls.cellM;
  // Sandy patches hold about a third as many; steep ground up to three times as many.
  // Even smooth ground keeps some grit; only boulders vanish from the sand.
  const floor = cls.name === 'pebble' ? 0.22 : cls.name === 'cobble' ? 0.07 : 0.03;
  const sand = rockiness === null ? 0.3 + 0.7 * Math.min(1, sandiness(cx, cz) * 1.6) : floor + 1.7 * Math.max(0, Math.min(1, rockiness)) ** 1.4;
  const expected = cls.perCell * sand * (1 + 2 * w);
  const count = Math.floor(expected) + (hash(ix, iz, salt + 1) < expected % 1 ? 1 : 0);
  const out: Rock[] = [];
  // Rocks are not sown evenly: a broken block lies among its own fragments, and wind leaves gravel in
  // lag patches. Part of each cell's rocks gather round one spot in it, the more so on rocky ground.
  const gx = (ix + 0.2 + 0.6 * hash(ix, iz, salt + 3)) * cls.cellM;
  const gz = (iz + 0.2 + 0.6 * hash(ix, iz, salt + 4)) * cls.cellM;
  const gather = 0.35 + 0.4 * Math.min(1, Math.max(0, rockiness ?? 0.4));
  // Rocky ground holds larger rocks too, not only more of them.
  const grow = 0.8 + 0.5 * Math.min(1, Math.max(0, rockiness ?? 0.4));
  for (let k = 0; k < count; k += 1) {
    let x = (ix + hash(ix, iz, salt + 10 + k * 5)) * cls.cellM;
    let z = (iz + hash(ix, iz, salt + 11 + k * 5)) * cls.cellM;
    if (hash(ix, iz, salt + 15 + k * 5) < gather) {
      // Scattered about the gathering spot, closer in more often than not.
      const a = hash(ix, iz, salt + 16 + k * 5) * Math.PI * 2;
      const r = cls.cellM * 0.32 * hash(ix, iz, salt + 17 + k * 5) ** 1.7;
      x = gx + Math.cos(a) * r;
      z = gz + Math.sin(a) * r;
    }
    if (keepOff?.(x, z)) continue;
    // Most rocks are small: the size is skewed toward the low end.
    const t = hash(ix, iz, salt + 12 + k * 5) ** 2.4;
    const size = (cls.minM + (cls.maxM - cls.minM) * t) * (1 + 0.5 * w) * grow;
    out.push({ x, z, size, yaw: hash(ix, iz, salt + 13 + k * 5) * Math.PI * 2, variant: hash(ix, iz, salt + 14 + k * 5) });
  }
  return out;
}
