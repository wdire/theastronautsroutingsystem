import { LinearMipmapLinearFilter, MeshStandardMaterial, NoColorSpace, RepeatWrapping, Texture, TextureLoader, Vector2 } from 'three';

export type GroundKind = 'far' | 'mid' | 'near' | 'close';

/** Shared by every ground material: 1 draws the close-up detail, 0 leaves it out. */
export const groundQuality = { value: 1 };

/** The three close-up materials (see tools/build_ground_textures.py): normal xy, brightness, height. */
const DETAIL_NAMES = ['regolith', 'gravel', 'bedrock'] as const;
const blank = new Texture();
const detail: Record<(typeof DETAIL_NAMES)[number], { value: Texture }> = {
  regolith: { value: blank },
  gravel: { value: blank },
  bedrock: { value: blank },
};
let detailLoading = false;

/** The close-up textures as shared uniforms, for other materials (the rocks) to read too. */
export const groundDetail = detail;

/** Starts loading the close-up textures once; materials pick them up as they arrive. */
export function loadGroundDetail(maxAnisotropy: number): void {
  if (detailLoading) return;
  detailLoading = true;
  const loader = new TextureLoader();
  for (const name of DETAIL_NAMES) {
    loader.load(`/textures/ground/${name}.webp`, (t) => {
      t.colorSpace = NoColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = maxAnisotropy;
      t.needsUpdate = true;
      detail[name].value = t;
    });
  }
}

const COMMON = /* glsl */ `
uniform vec2 uHoleCenter;
uniform float uHoleHalf;
uniform float uGdQuality;
uniform float uCoarse;
uniform sampler2D uHi;
uniform float uHasHi;
uniform sampler2D uRegolith;
uniform sampler2D uGravel;
uniform sampler2D uBedrock;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec2 vUvHi;
varying vec2 vSoil;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
// 1 while a feature of this size is larger than a pixel, fading to 0 before it turns to shimmer.
float show(float size, float px) {
  return 1.0 - smoothstep(size * 0.22, size * 0.6, px);
}
// Orbital colour graded toward the rust-red of Mastcam-Z's white-balanced frames: oxidised dust is redder
// than the orbital mosaics show it, rock is browner, nothing is beige.
vec3 marsGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, 0.88) * vec3(0.96, 0.76, 0.62);
}
// What the surface itself varies by at a few metres, which no orbiter resolves: pale, light-toned rock
// slabs and veins (the mudstones Curiosity and Perseverance drive over), dark basaltic sand in drifts, and
// redder dust between. Returns a multiplier for the colour.
vec3 groundPatches(vec2 p, float px, float hiOn) {
  float vis = show(6.0, px);
  float slabs = smoothstep(0.49, 0.58, fbm(p * 0.075 + 4.0)) * (0.55 + 0.45 * smoothstep(0.4, 0.6, fbm(p * 0.5)));
  float veins = smoothstep(0.86, 0.96, 1.0 - abs(fbm(p * 0.14 + 9.0) * 2.0 - 1.0)) * show(1.5, px);
  float drift = smoothstep(0.5, 0.6, fbm(p * 0.03 + 21.0));
  float rust = fbm(p * 0.22 + 2.0) - 0.5;
  float k = mix(1.0, 0.7, hiOn) * vis;
  vec3 m = vec3(1.0);
  m = mix(m, vec3(1.55, 1.42, 1.34), clamp(slabs + veins * 0.8, 0.0, 1.0) * 0.8 * k);
  m = mix(m, vec3(0.58, 0.55, 0.56), drift * 0.65 * k);
  m *= 1.0 + vec3(0.1, -0.02, -0.08) * rust * 1.6 * k;
  return m;
}
// Mars's loose sand is basaltic: darker and greyer than the dust-covered ground around it.
vec3 sandTone(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, 0.62) * vec3(0.7, 0.68, 0.69);
}
// A tiled texture read twice, at two sizes and turned against each other, so its repeat is not seen.
vec4 twoScale(sampler2D t, vec2 p, float size) {
  vec4 a = texture2D(t, p / size);
  vec2 q = mat2(0.7986, -0.6018, 0.6018, 0.7986) * p;
  vec4 b = texture2D(t, q / (size * 2.71) + 0.37);
  return mix(a, b, 0.38);
}
`;

/** Tone and bedding only: for ground seen from hundreds of metres away. */
const DETAIL_COARSE = /* glsl */ `
{
  vec2 p = vWPos.xz;
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float slope = degrees(acos(clamp(normalize(vWNormal).y, 0.0, 1.0)));
  float tone = (fbm(p * 0.004) - 0.5) * show(120.0, px) + (fbm(p * 0.03) - 0.5) * 0.6 * show(18.0, px);
  diffuseColor.rgb *= 1.0 + tone * 0.32;
  diffuseColor.rgb *= mix(vec3(1.0), groundPatches(p, px, 0.0), 0.6);
  float rock = max(smoothstep(4.0, 12.0, slope + (fbm(p * 0.006) - 0.5) * 5.0), vSoil.y * 0.6);
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.9, 0.84, 0.8), rock * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, sandTone(diffuseColor.rgb), vSoil.x * 0.6);
  diffuseColor.rgb = marsGrade(diffuseColor.rgb);
}
`;

/**
 * The ground near the viewer. Colour comes from the orbital mosaic; inside Jezero’s HiRISE mosaic its
 * brightness is replaced, ratio for ratio, by HiRISE’s 25 cm to 1 m image, so real ripples, outcrops and
 * boulders show. Within a few tens of metres three close-up materials add the grain the orbiters cannot
 * see: regolith on the flat, gravel where the image is broken, bedrock where it is bright or steep.
 */
const DETAIL_NEAR = /* glsl */ `
{
  vec2 p = vWPos.xz;
  float dist = length(vWPos - cameraPosition);
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float slope = degrees(acos(clamp(normalize(vWNormal).y, 0.0, 1.0)));
  vec3 base = diffuseColor.rgb;

  // HiRISE: local contrast over the orbital colour, and two blurred reads that say what kind of ground it is.
  float hiOn = 0.0;
  float ratio = 1.0;
  float outcrop = 0.0;
  float broken = 0.4;
  if (uHasHi > 0.5) {
    vec4 hi = texture2D(uHi, vUvHi);
    hiOn = smoothstep(0.4, 0.9, hi.a);
    float mean = texture2D(uHi, vUvHi, 4.5).r;
    float wide = texture2D(uHi, vUvHi, 7.5).r;
    ratio = clamp(hi.r / max(mean, 0.03), 0.3, 2.0);
    // Light-toned rock stands out brighter than the ground around it; dark ground in Jezero is sand.
    outcrop = smoothstep(1.04, 1.32, mean / max(wide, 0.03)) * hiOn;
    float fine = abs(texture2D(uHi, vUvHi, 1.5).r - mean) / max(mean, 0.03);
    broken = mix(broken, smoothstep(0.02, 0.1, fine), hiOn);
  }
  // A gentle curve on the ratio: shadows of rocks stay dark, bright faces do not clip.
  float lift = ratio < 1.0 ? pow(ratio, 1.6) : 1.0 + (ratio - 1.0) * 1.05;
  base *= mix(1.0, lift, hiOn);

  // Tone patches the orbiters would show as one pixel: dust drifts, lag gravel, darker wind streaks.
  float tone = (fbm(p * 0.012) - 0.5) * 1.2 * show(60.0, px) + (fbm(p * 0.05) - 0.5) * show(12.0, px) + (fbm(p * 0.6) - 0.5) * 0.5 * show(1.2, px);
  base *= 1.0 + tone * mix(0.38, 0.12, hiOn);
  base *= groundPatches(p, px, hiOn);

  // The invented relief's soil: dark sand in hollows and ridge fields, rock on rims and knobs.
  float sand = vSoil.x * (1.0 - hiOn * 0.7) * smoothstep(0.15, 0.6, vSoil.x + (fbm(p * 0.09 + 3.0) - 0.5) * 0.5);
  float soilRock = vSoil.y * (1.0 - hiOn * 0.7);
  base = mix(base, sandTone(base), sand * 0.75);
  // Dust settles brightest on the gentle rises between.
  base *= 1.0 + (1.0 - sand) * (1.0 - soilRock) * 0.06;

  float bed = max(max(outcrop, smoothstep(14.0, 26.0, slope + (fbm(p * 0.07) - 0.5) * 8.0)), smoothstep(0.45, 0.85, soilRock + (fbm(p * 0.13) - 0.5) * 0.45) * 0.85);
  float grav = (1.0 - bed) * smoothstep(0.3, 0.75, broken + soilRock * 0.6 + (fbm(p * 0.21 + 7.0) - 0.5) * 0.5) * (1.0 - sand);
  float reg = max(0.0, 1.0 - bed - grav);

  // Rock is greyer and a little darker than the dust around it.
  float lumB = dot(base, vec3(0.2126, 0.7152, 0.0722));
  base = mix(base, mix(vec3(lumB), base, 0.55) * 0.92, bed * 0.6);

  float near = (1.0 - smoothstep(50.0, 170.0, dist)) * uGdQuality;
  if (near > 0.001) {
    vec4 r = twoScale(uRegolith, p, 1.9);
    vec4 g = twoScale(uGravel, p, 1.6);
    vec4 b = twoScale(uBedrock, p, 2.6);
    // Height-aware blending: the higher material shows through where two meet.
    vec3 w = vec3(reg, grav, bed) * (vec3(r.a, g.a, b.a) * 0.6 + 0.4);
    w = pow(w, vec3(3.0));
    w /= max(1e-4, w.x + w.y + w.z);
    vec4 m = r * w.x + g * w.y + b * w.z;
    float lumD = (m.b - 0.5) * 2.2;
    base *= 1.0 + lumD * near * mix(0.9, 0.7, hiOn);
    vec2 nd = m.rg * 2.0 - 1.0;
    gdBump = vec2(nd.x, -nd.y) * near * 1.15;
  }
  diffuseColor.rgb = marsGrade(base);
}
`;

/**
 * The material of one ground layer. Every variant names itself in customProgramCacheKey: three.js
 * shares compiled programs between materials whose keys match, and the default key is only the text
 * of onBeforeCompile, which is the same function here for every layer.
 */
export function groundMaterial(kind: GroundKind, map: Texture, hole: { center: Vector2; half: number }, coarse: number, hi: Texture | null = null): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.97, metalness: 0 });
  const close = kind === 'near' || kind === 'close';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoleCenter = { value: hole.center };
    shader.uniforms.uHoleHalf = { value: hole.half };
    shader.uniforms.uGdQuality = groundQuality;
    shader.uniforms.uCoarse = { value: coarse };
    shader.uniforms.uHi = { value: hi ?? blank };
    shader.uniforms.uHasHi = { value: hi ? 1 : 0 };
    shader.uniforms.uRegolith = detail.regolith;
    shader.uniforms.uGravel = detail.gravel;
    shader.uniforms.uBedrock = detail.bedrock;
    material.userData.uniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvHi;\nattribute vec2 soil;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying vec2 vUvHi;\nvarying vec2 vSoil;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * normal);\nvUvHi = uvHi;\nvSoil = soil;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace(
        'void main() {',
        'void main() {\nif (uHoleHalf > 0.0 && abs(vWPos.x - uHoleCenter.x) < uHoleHalf && abs(vWPos.z - uHoleCenter.y) < uHoleHalf) discard;\nvec2 gdBump = vec2(0.0);',
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${close ? DETAIL_NEAR : DETAIL_COARSE}`)
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(gdBump.x, 0.0, gdBump.y, 0.0)).xyz);',
      );
  };
  material.customProgramCacheKey = () => `areo-ground4|${close ? 'near' : 'coarse'}`;
  return material;
}
