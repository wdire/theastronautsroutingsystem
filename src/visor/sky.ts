import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { SkyState } from './skyModel';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunPower;
uniform float uAureole;
uniform float uStars;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  // Dust is thickest along the horizon, so the sky is palest there.
  vec3 col = mix(uHorizon, uZenith, 1.0 - pow(1.0 - h, 3.2));
  // Below the horizon the dome only fills gaps: keep it the colour of far haze.
  col = mix(col, uHorizon * 0.82, 1.0 - smoothstep(-0.12, 0.0, d.y));

  float mu = max(dot(d, uSunDir), 0.0);
  // The blue glow dust scatters forward around a low sun.
  col += vec3(0.36, 0.52, 0.82) * uAureole * (pow(mu, 6.0) * 0.28 + pow(mu, 48.0) * 0.55);
  // Warm glare around the sun by day.
  col += uSunColor * uSunPower * (pow(mu, 220.0) * 0.12 + pow(mu, 2600.0) * 0.5);
  // The disc: 0.35 degrees across from Mars, about two thirds of its size from Earth.
  float disc = smoothstep(0.9999905, 0.9999955, dot(d, uSunDir));
  col += uSunColor * disc * (2.0 + 6.0 * uSunPower);

  if (uStars > 0.01 && d.y > 0.0) {
    vec3 cell = floor(d * 190.0);
    float s = hash13(cell);
    float star = step(0.9965, s) * (0.4 + 0.6 * hash13(cell + 7.0));
    col += vec3(star) * uStars * smoothstep(0.0, 0.12, d.y);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The sky dome. It rides with the camera and draws behind everything. */
export function createSky(): { mesh: Mesh; update(state: SkyState, sunDir: Vector3): void; dispose(): void } {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uSunPower: { value: 1 },
      uAureole: { value: 0 },
      uStars: { value: 0 },
    },
  });
  const geometry = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  const u = material.uniforms;
  return {
    mesh,
    update(state, sunDir) {
      (u.uZenith?.value as Color).setRGB(...state.zenith);
      (u.uHorizon?.value as Color).setRGB(...state.horizon);
      (u.uSunColor?.value as Color).setRGB(...state.sun);
      (u.uSunDir?.value as Vector3).copy(sunDir);
      if (u.uSunPower) u.uSunPower.value = Math.min(1, state.sunIntensity / 3);
      if (u.uAureole) u.uAureole.value = state.aureole;
      if (u.uStars) u.uStars.value = state.stars;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
