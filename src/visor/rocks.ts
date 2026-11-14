import { BufferAttribute, Color, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Scene } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundDetail, groundQuality } from './groundShader';
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

const HEIGHT: Record<Shape, number> = { platy: 0.42, lumpy: 0.72, block: 0.8 };

/**
 * A unit rock: an icosphere pushed out of shape, dusty on the faces that look up. `detail` is the
 * icosphere’s subdivision: the same rock is built coarse for the distance and fine for close by.
 */
function rockGeometry(shape: Shape, seed: number, detail: number): BufferGeometry {
  // The icosphere comes as loose triangles; welding them lets the normals run smooth across faces.
  const loose = new IcosahedronGeometry(0.5, detail);
  loose.deleteAttribute('normal');
  loose.deleteAttribute('uv');
  const g = mergeVertices(loose, 1e-4);
  loose.dispose();
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const dir = new Vector3();
  // Planes that slice a block into flat faces; welded normals round the edges between them.
  const cuts = shape === 'block' ? Array.from({ length: 7 }, (_, i) => ({ n: new Vector3(hash(i, seed, 1) - 0.5, hash(i, seed, 2) - 0.35, hash(i, seed, 3) - 0.5).normalize(), d: 0.24 + hash(i, seed, 4) * 0.18 })) : [];
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    const lump = lobes(dir.x, dir.y, dir.z, seed);
    if (shape === 'block') {
      v.copy(dir).multiplyScalar(0.5 * (1 + lump * 0.08));
      for (const c of cuts) {
        const over = v.dot(c.n) - c.d;
        if (over > 0) v.addScaledVector(c.n, -over);
      }
    } else {
      v.copy(dir).multiplyScalar(0.5 * (1 + lump * 0.2));
    }
    v.y *= HEIGHT[shape];
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Vertex colours: dark basalt below, the ground’s butterscotch dust settled on the faces that look up.
  const normal = g.getAttribute('normal');
  const colours = new Float32Array(normal.count * 3);
  const rock = new Color(0.22, 0.185, 0.16);
  const dust = new Color(0.5, 0.37, 0.27);
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

/**
 * Rock surfaces are not smooth paint: this adds mottling and a pitted relief from noise in the rock’s
 * own space, faded out as the rock shrinks on screen so it never shimmers.
 */
function rockMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockQuality = groundQuality;
    shader.uniforms.uRockTex = groundDetail.bedrock;
    // Texture coordinates in metres about each rock, so a boulder is not a scaled-up pebble.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef USE_INSTANCING\n  vRockPos = mat3(instanceMatrix) * position + fract(instanceMatrix[3].xyz * 0.173) * 17.0;\n  vRockN = normalize(mat3(instanceMatrix) * normal);\n#else\n  vRockPos = position;\n  vRockN = normal;\n#endif',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRockPos;
varying vec3 vRockN;
uniform float rockQuality;
uniform sampler2D uRockTex;
// The bedrock photograph's height and brightness, read along the three axes and blended by the face's facing.
vec4 rockTri(vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(uRockTex, p.yz) * w.x + texture2D(uRockTex, p.xz) * w.y + texture2D(uRockTex, p.xy) * w.z;
}
float rockHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rockNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x), mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x), mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float rockRelief(vec3 p) { return rockNoise(p) * 0.6 + rockNoise(p * 2.7 + 3.1) * 0.28 + rockNoise(p * 7.3 + 9.7) * 0.12; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // How much of the noise a pixel can still resolve: 1 close by, 0 when a pixel spans a whole feature.
  float rockFade = 1.0 - smoothstep(0.006, 0.05, length(fwidth(vRockPos)));
  vec4 rockT = rockTri(vRockPos / 0.9, vRockN);
  float rockH = rockT.a * 0.75 + rockRelief(vRockPos * 9.0) * 0.25;
  diffuseColor.rgb *= mix(1.0, 0.6 + 0.8 * rockT.b, rockFade);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  if (rockQuality > 0.5 && rockFade > 0.01) {
    vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec2 dh = vec2(dFdx(rockH), dFdy(rockH)) * (0.02 * rockFade);
    normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  }`,
      );
  };
  material.customProgramCacheKey = () => 'areo-rock2';
  return material;
}

interface Batch {
  cls: RockClass;
  shape: Shape;
  /** Close by, with every facet and a shadow. */
  near: InstancedMesh;
  /** The same rocks drawn coarse, where they are a few pixels across. */
  far: InstancedMesh;
  /** Which rocks of the class this batch draws: those whose variant falls in [from, to). */
  from: number;
  to: number;
}

const CAPACITY: Record<RockClass['name'], number> = { pebble: 16_000, cobble: 11_000, boulder: 1_400 };
/** Icosphere detail close by and far off, and the distance where one gives way to the other, m. */
const LOD: Record<RockClass['name'], { near: number; far: number; withinM: number }> = {
  pebble: { near: 1, far: 0, withinM: 24 },
  cobble: { near: 2, far: 0, withinM: 80 },
  boulder: { near: 3, far: 1, withinM: 230 },
};

/**
 * The rocks around the viewer, as instanced meshes. `update` re-places them when the viewer has
 * crossed into a new cell; it is cheap enough to call every frame.
 */
export function createRocks(
  scene: Scene,
  heightAt: (x: number, z: number) => number | null,
  slopeAt: (x: number, z: number) => number,
  /** Discs kept free of rocks: under vehicles and buildings. */
  clearings: readonly { x: number; z: number; r: number }[] = [],
  /** How broken the ground is seen from orbit, 0 to 1, or null where that is not known. */
  rockinessAt: (x: number, z: number) => number | null = () => null,
) {
  const material = rockMaterial();
  const layout: [RockClass['name'], Shape, number, number][] = [
    ['pebble', 'block', 0, 0.5],
    ['pebble', 'platy', 0.5, 1],
    ['cobble', 'lumpy', 0, 0.3],
    ['cobble', 'block', 0.3, 1],
    ['boulder', 'block', 0, 0.8],
    ['boulder', 'platy', 0.8, 1],
  ];
  const instanced = (geometry: BufferGeometry, capacity: number): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  };
  const batches: Batch[] = layout.map(([name, shape, from, to], i) => {
    const cls = ROCK_CLASSES.find((c) => c.name === name) ?? ROCK_CLASSES[0]!;
    const lod = LOD[name];
    const capacity = Math.ceil(CAPACITY[name] * (to - from) * 1.15);
    // The share of a class’s disc that lies inside the near ring, with room to spare.
    const nearShare = Math.min(1, (lod.withinM / cls.radiusM) ** 2 * 2.5 + 0.02);
    const near = instanced(rockGeometry(shape, 11 + i * 7, lod.near), Math.ceil(capacity * nearShare));
    const far = instanced(rockGeometry(shape, 11 + i * 7, lod.far), capacity);
    near.castShadow = name !== 'pebble';
    return { cls, shape, near, far, from, to };
  });

  const lastCell = new Map<RockClass['name'], string>();
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const tint = new Color();
  const UP = new Vector3(0, 1, 0);
  const ground = new Vector3();
  const spin = new Quaternion();
  let lowQuality = false;
  let hidden = false;

  const place = (cls: RockClass, cx: number, cz: number) => {
    const mine = batches.filter((b) => b.cls === cls);
    const nearCount = mine.map(() => 0);
    const farCount = mine.map(() => 0);
    const within = LOD[cls.name].withinM;
    // Only the clearings this class's disc can reach, so most rocks are tested against none.
    const blocked = clearings.filter((c) => Math.hypot(c.x - cx, c.z - cz) < cls.radiusM + c.r + 4);
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
        for (const rock of rocksInCell(cls, ix, iz, slopeAt(mx, mz), undefined, rockinessAt(mx, mz))) {
          if (blocked.length > 0 && blocked.some((c) => (rock.x - c.x) ** 2 + (rock.z - c.z) ** 2 < (c.r + rock.size / 2) ** 2)) continue;
          const y = heightAt(rock.x, rock.z);
          if (y === null) continue;
          const b = mine.findIndex((batch) => rock.variant >= batch.from && rock.variant < batch.to);
          const batch = mine[b];
          if (!batch) continue;
          const close = Math.hypot(rock.x - cx, rock.z - cz) < within;
          const mesh = close ? batch.near : batch.far;
          const counts = close ? nearCount : farCount;
          const n = counts[b] ?? 0;
          if (n >= mesh.instanceMatrix.count) continue;
          const height = rock.size * HEIGHT[batch.shape];
          p.set(rock.x, y + height * (0.5 - cls.sink), rock.z);
          // A rock rests on the slope it lies on, with a little lean of its own.
          const e = Math.max(0.25, rock.size * 0.5);
          const hx = (heightAt(rock.x + e, rock.z) ?? y) - (heightAt(rock.x - e, rock.z) ?? y);
          const hz = (heightAt(rock.x, rock.z + e) ?? y) - (heightAt(rock.x, rock.z - e) ?? y);
          ground.set(-hx / (2 * e) + (rock.variant - 0.5) * 0.25, 1, -hz / (2 * e) + (((rock.variant * 13.7) % 1) - 0.5) * 0.25).normalize();
          q.setFromUnitVectors(UP, ground).multiply(spin.setFromAxisAngle(UP, rock.yaw));
          s.set(rock.size, rock.size, rock.size * (0.75 + rock.variant * 0.5));
          m.compose(p, q, s);
          mesh.setMatrixAt(n, m);
          const shade = 0.72 + ((rock.variant * 7.13) % 1) * 0.5;
          mesh.setColorAt(n, tint.setRGB(shade, shade * 0.98, shade * 0.96));
          counts[b] = n + 1;
        }
      }
    }
    mine.forEach((batch, i) => {
      for (const [mesh, count] of [[batch.near, nearCount[i] ?? 0], [batch.far, farCount[i] ?? 0]] as const) {
        mesh.count = count;
        // Upload only the rocks in use, not the whole reserved buffer.
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, count * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
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
    setVisible(on: boolean) {
      hidden = !on;
      for (const b of batches) b.near.visible = b.far.visible = on && !(lowQuality && b.cls.name === 'pebble');
    },
    count: () => batches.reduce((n, b) => n + (b.near.visible ? b.near.count + b.far.count : 0), 0),
    setLowQuality(low: boolean) {
      lowQuality = low;
      for (const b of batches) {
        if (b.cls.name === 'pebble') b.near.visible = b.far.visible = !low && !hidden;
        if (b.cls.name === 'cobble') b.near.castShadow = !low;
      }
      if (!low) lastCell.clear();
    },
    dispose() {
      for (const b of batches) {
        for (const mesh of [b.near, b.far]) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.dispose();
        }
      }
      material.dispose();
    },
  };
}
