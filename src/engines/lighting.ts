/**
 * How the map is lit for a given sun position: the hillshade follows the real sun,
 * the imagery dims toward night, and the sky goes from butterscotch to near black.
 */
export interface MapLighting {
  /** Direction the light comes from, degrees clockwise from north. */
  direction: number;
  /** Height of the light above the horizon used for shading, degrees (8 to 70). */
  height: number;
  /** Hillshade strength, 0.55 at noon to 0.85 at the horizon. */
  strength: number;
  /** Upper limit of imagery brightness: 1 by day, 0.82 near sunset, 0.4 at night. */
  brightness: number;
  /** Sky and horizon colours as CSS rgb() strings. */
  sky: string;
  horizon: string;
  /** 'day', 'twilight' or 'night', for labels. */
  phase: 'day' | 'twilight' | 'night';
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

function rgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): string {
  return `rgb(${Math.round(mix(a[0], b[0], t))} ${Math.round(mix(a[1], b[1], t))} ${Math.round(mix(a[2], b[2], t))})`;
}

const SKY_DAY = [214, 170, 122] as const; // butterscotch, as Mastcam-Z sees the daytime sky
const SKY_LOW = [138, 104, 82] as const; // browner haze with the sun low
const SKY_NIGHT = [10, 9, 12] as const;
const HORIZON_DAY = [226, 190, 148] as const;
const HORIZON_LOW = [150, 132, 128] as const; // the cool glow around a Martian sunset
const HORIZON_NIGHT = [16, 14, 18] as const;

export function mapLighting(sunElevDeg: number, sunAzDeg: number): MapLighting {
  const elev = Number.isFinite(sunElevDeg) ? sunElevDeg : 45;
  const az = Number.isFinite(sunAzDeg) ? ((sunAzDeg % 360) + 360) % 360 : 315;
  const height = clamp(elev, 8, 70);
  // 0 at the horizon, 1 with the sun at 70 degrees or more.
  const up = clamp((height - 8) / 62, 0, 1);
  const strength = mix(0.85, 0.55, up);

  // Day above 12 degrees, sunset band between 12 and 0, dark below -6.
  const day = smooth(0, 12, elev);
  const dusk = smooth(-6, 0, elev);
  const brightness = elev >= 0 ? mix(0.82, 1, day) : mix(0.4, 0.82, dusk);
  const sky = elev >= 0 ? rgb(SKY_LOW, SKY_DAY, day) : rgb(SKY_NIGHT, SKY_LOW, dusk);
  const horizon = elev >= 0 ? rgb(HORIZON_LOW, HORIZON_DAY, day) : rgb(HORIZON_NIGHT, HORIZON_LOW, dusk);
  const phase = elev > 4 ? 'day' : elev > -6 ? 'twilight' : 'night';
  return { direction: az, height, strength, brightness, sky, horizon, phase };
}
