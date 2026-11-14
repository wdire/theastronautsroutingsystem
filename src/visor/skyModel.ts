/** Colours and light levels of the Martian sky for a sun height and dust load. Pure, so it can be tested. */
export type Rgb = [number, number, number];

export interface SkyState {
  zenith: Rgb;
  horizon: Rgb;
  /** Colour and strength of direct sunlight on the ground. */
  sun: Rgb;
  sunIntensity: number;
  /** Light from the whole sky. */
  ambient: number;
  /** The blue glow around a low sun, 0 to 1. */
  aureole: number;
  /** 0 by day, 1 on a dark night. */
  stars: number;
  fog: Rgb;
  /** Exponential fog density, per metre. */
  fogDensity: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (lo: number, hi: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

const DAY_ZENITH: Rgb = [0.62, 0.45, 0.3];
const DAY_HORIZON: Rgb = [0.88, 0.71, 0.52];
const LOW_ZENITH: Rgb = [0.3, 0.25, 0.23];
const LOW_HORIZON: Rgb = [0.52, 0.45, 0.42];
const NIGHT_ZENITH: Rgb = [0.008, 0.008, 0.013];
const NIGHT_HORIZON: Rgb = [0.03, 0.028, 0.034];
const STORM: Rgb = [0.5, 0.32, 0.18];

export function skyState(sunElevDeg: number, tau: number, visibilityKm: number): SkyState {
  const day = smooth(0, 16, sunElevDeg);
  const dusk = smooth(-8, 0, sunElevDeg);
  let zenith = sunElevDeg >= 0 ? mix3(LOW_ZENITH, DAY_ZENITH, day) : mix3(NIGHT_ZENITH, LOW_ZENITH, dusk);
  let horizon = sunElevDeg >= 0 ? mix3(LOW_HORIZON, DAY_HORIZON, day) : mix3(NIGHT_HORIZON, LOW_HORIZON, dusk);

  // Heavy dust flattens the sky toward one dim ochre.
  const storm = smooth(1.2, 4.5, tau);
  const dim = Math.exp(-0.22 * Math.max(0, tau - 0.6));
  zenith = mix3(zenith, [STORM[0] * (0.2 + 0.8 * dusk), STORM[1] * (0.2 + 0.8 * dusk), STORM[2] * (0.2 + 0.8 * dusk)], storm * 0.8).map((v) => v * dim) as Rgb;
  horizon = mix3(horizon, [STORM[0] * dusk, STORM[1] * dusk, STORM[2] * dusk], storm * 0.7).map((v) => v * dim) as Rgb;

  const up = smooth(-1, 28, sunElevDeg);
  const sun = mix3([0.78, 0.84, 1.0], [1.0, 0.93, 0.82], day);
  const sunIntensity = 3.3 * up * Math.exp(-0.4 * Math.max(0, tau - 0.4)) * (1 - storm * 0.5);
  const ambient = (0.14 + 1.05 * smooth(-6, 20, sunElevDeg)) * (0.75 + 0.25 * dim);
  const aureole = (1 - smooth(4, 22, sunElevDeg)) * smooth(-7, -1, sunElevDeg) * (1 - storm);
  const stars = (1 - smooth(-10, -3, sunElevDeg)) * (1 - storm);
  return {
    zenith,
    horizon,
    sun,
    sunIntensity,
    ambient,
    aureole,
    stars,
    fog: horizon,
    fogDensity: 2.3 / (Math.max(1.5, visibilityKm) * 1000),
  };
}
