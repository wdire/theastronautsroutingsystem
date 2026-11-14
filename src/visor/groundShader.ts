import { MeshStandardMaterial, Vector2, type Texture } from 'three';

export type GroundKind = 'far' | 'mid' | 'near';

/** Shared by every ground material: 1 draws joints and centimetre bumps, 0 leaves them out. */
export const groundQuality = { value: 1 };

const COMMON = /* glsl */ `
uniform vec2 uHoleCenter;
uniform float uHoleHalf;
uniform float uGdQuality;
uniform float uCoarse;
varying vec3 vWPos;
varying vec3 vWNormal;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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
// Distance to the nearest cell edge of a jittered grid, and a random value for the cell.
vec3 blocks(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash22(i + g);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = hash12(i + g + 7.7); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(d2 - d1, id, d1);
}
`;

/** Tone and bedding only: for ground seen from hundreds of metres away. */
const DETAIL_COARSE = /* glsl */ `
{
  vec2 p = vWPos.xz;
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float slope = degrees(acos(clamp(normalize(vWNormal).y, 0.0, 1.0)));
  float tone = (fbm(p * 0.004) - 0.5) * show(120.0, px) + (fbm(p * 0.03) - 0.5) * 0.6 * show(18.0, px);
  diffuseColor.rgb *= 1.0 + tone * 0.22;
  float rock = smoothstep(4.0, 12.0, slope + (fbm(p * 0.006) - 0.5) * 5.0);
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.9, 0.84, 0.8), rock * 0.35);
  float h = vWPos.y + fbm(p * 0.01) * 6.0;
  float bw = fwidth(h) / 14.0;
  float band = (1.0 - smoothstep(0.0, 0.16, fract(h / 14.0))) * (1.0 - smoothstep(0.25, 0.6, bw));
  diffuseColor.rgb *= 1.0 - band * rock * 0.2;
}
`;

/** The ground under your feet: sand, ripples and grains on the flat, bedded and jointed rock on slopes. */
const DETAIL_NEAR = /* glsl */ `
{
  vec2 p = vWPos.xz;
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float slope = degrees(acos(clamp(normalize(vWNormal).y, 0.0, 1.0)));
  float lo = mix(7.0, 4.0, uCoarse);
  float hi = mix(15.0, 12.0, uCoarse);
  float rock = smoothstep(lo, hi, slope + (fbm(p * 0.03) - 0.5) * 7.0);
  float pavement = smoothstep(0.6, 0.7, fbm(p * 0.006 + 31.0));
  rock = max(rock, pavement * 0.85);
  float sand = 1.0 - rock;

  // Sand and dust: tone patches at several sizes.
  float tone = (fbm(p * 0.02) - 0.5) * show(30.0, px) + (fbm(p * 0.25) - 0.5) * 0.7 * show(3.0, px) + (fbm(p * 2.3) - 0.5) * 0.5 * show(0.35, px);
  vec3 col = diffuseColor.rgb * (1.0 + tone * 0.3);

  // Ripples whose direction drifts: a few metres apart, and a hand's width apart close up.
  float ang = 0.9 + (fbm(p * 0.008) - 0.5) * 1.6;
  vec2 dir = vec2(cos(ang), sin(ang));
  float patchy = smoothstep(0.42, 0.62, fbm(p * 0.015 + 5.0));
  // The phase is bent by noise so crests wander, fork and die out instead of running ruler-straight.
  float bigPhase = dot(p, dir) * 2.1 + fbm(p * 0.11) * 9.0;
  float smallPhase = dot(p, dir) * 24.0 + fbm(p * 0.9) * 11.0;
  float smallPatch = smoothstep(0.38, 0.6, fbm(p * 0.07 + 23.0));
  float bigAmp = show(3.0, px) * patchy;
  float smallAmp = show(0.26, px) * smallPatch;
  float rip = sin(bigPhase) * 0.55 * bigAmp + sin(smallPhase) * 0.3 * smallAmp;
  col *= 1.0 + rip * 0.07 * sand;
  gdBump = dir * (cos(bigPhase) * bigAmp * 0.13 + cos(smallPhase) * smallAmp * 0.1) * sand;

  // Grains on a jittered grid turned off the axes, so they never line up in rows.
  float gs = show(0.05, px);
  if (gs > 0.01) {
    vec2 q = mat2(0.8253, -0.5646, 0.5646, 0.8253) * p * 34.0;
    vec3 g = blocks(q);
    float grain = (1.0 - smoothstep(0.08, 0.32, g.z)) * step(0.55, g.y);
    col *= 1.0 - grain * 0.28 * gs;
    col *= 1.0 + (g.y - 0.5) * 0.1 * gs;
  }

  // Bedrock: darker and greyer, bedded by height, jointed into blocks.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 stone = mix(col, vec3(lum) * vec3(0.9, 0.8, 0.72), 0.55) * 0.84;
  float h = vWPos.y + (fbm(p * 0.05) - 0.5) * 1.2;
  float fh = fwidth(h);
  float bed = 0.0;
  bed += (1.0 - smoothstep(0.0, 0.22, fract(h / 0.45))) * (1.0 - smoothstep(0.1, 0.3, fh / 0.45)) * 0.55;
  bed += (1.0 - smoothstep(0.0, 0.14, fract(h / 2.3))) * (1.0 - smoothstep(0.1, 0.3, fh / 2.3)) * 0.8;
  bed += (1.0 - smoothstep(0.0, 0.1, fract(h / 14.0))) * (1.0 - smoothstep(0.1, 0.3, fh / 14.0));
  stone *= 1.0 - min(1.0, bed) * 0.3;
  if (uGdQuality > 0.5) {
    vec3 j1 = blocks(p / 0.9 + 3.0);
    vec3 j2 = blocks(p / 4.2 + 11.0);
    float s1 = show(0.9, px * 2.5);
    float s2 = show(4.2, px * 2.5);
    // Joints open and close along their length: not every block edge is a crack.
    float open1 = smoothstep(0.35, 0.65, fbm(p * 0.7 + 40.0));
    float open2 = smoothstep(0.3, 0.6, fbm(p * 0.16 + 60.0));
    float joint = (1.0 - smoothstep(0.015, 0.07, j1.x)) * s1 * 0.5 * open1 + (1.0 - smoothstep(0.008, 0.035, j2.x)) * s2 * 0.6 * open2;
    stone *= 1.0 - min(1.0, joint) * 0.42;
    // Each block's face is tilted its own way.
    stone *= 1.0 + (j1.y - 0.5) * 0.22 * s1 + (j2.y - 0.5) * 0.16 * s2;
    gdBump += (hash22(vec2(j1.y, j2.y) * 97.0) - 0.5) * 0.35 * s1 * rock;
  }
  // Dust settles on faces that look up.
  float dust = smoothstep(0.45, 0.75, fbm(p * 0.4 + 9.0)) * (1.0 - smoothstep(10.0, 24.0, slope));
  stone = mix(stone, col, dust * 0.65);
  diffuseColor.rgb = mix(col, stone, rock);
}
`;

/**
 * The material of one ground layer. Every variant names itself in customProgramCacheKey: three.js
 * shares compiled programs between materials whose keys match, and the default key is only the text
 * of onBeforeCompile, which is the same function here for all three layers.
 */
export function groundMaterial(kind: GroundKind, map: Texture, hole: { center: Vector2; half: number }, coarse: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
  const near = kind === 'near';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoleCenter = { value: hole.center };
    shader.uniforms.uHoleHalf = { value: hole.half };
    shader.uniforms.uGdQuality = groundQuality;
    shader.uniforms.uCoarse = { value: coarse };
    material.userData.uniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * normal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace(
        'void main() {',
        'void main() {\nif (uHoleHalf > 0.0 && abs(vWPos.x - uHoleCenter.x) < uHoleHalf && abs(vWPos.z - uHoleCenter.y) < uHoleHalf) discard;\nvec2 gdBump = vec2(0.0);',
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${near ? DETAIL_NEAR : DETAIL_COARSE}`)
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(gdBump.x, 0.0, gdBump.y, 0.0)).xyz * uGdQuality);',
      );
  };
  material.customProgramCacheKey = () => `areo-ground|${kind}|hole|gd${near ? 1 : 0}`;
  return material;
}
