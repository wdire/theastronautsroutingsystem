/**
 * Colour grading for the ground seen at eye level. Orbital colour looks maroon from a metre and a
 * half up; the rovers' cameras see butterscotch dust. The luminance of the orbital image is kept
 * and placed on the colour Mastcam-Z records, with pale ground rolled off so rims do not clip.
 */
export const BUTTERSCOTCH: readonly [number, number, number] = [0.84, 0.63, 0.45];

/** How bright the butterscotch is drawn for an image luminance in 0..1: 0.5 in shadow, bending over above 0.25. */
export function gradeGain(lum: number): number {
  return 0.5 + (1.15 * lum) / (1 + 1.2 * Math.max(0, lum - 0.25));
}

const TINT_LUM = 0.2126 * BUTTERSCOTCH[0] + 0.7152 * BUTTERSCOTCH[1] + 0.0722 * BUTTERSCOTCH[2];

/** Grades one sRGB colour (components 0..1): 70% butterscotch at the graded brightness, 30% its own hue. */
export function gradeColour(r: number, g: number, b: number): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = gradeGain(lum);
  // The original hue, brought to the brightness of the graded colour, keeps real colour differences.
  // Each channel's share of the brightness is limited: in dark pixels a small tint would otherwise
  // be multiplied into a saturated red or green.
  const target = k * TINT_LUM;
  const own = lum > 0.02 ? 0.3 : 0;
  const tint = 1 - own;
  const share = (c: number) => Math.max(0.6, Math.min(1.5, c / Math.max(lum, 0.02)));
  return [
    Math.min(1, tint * BUTTERSCOTCH[0] * k + own * share(r) * target),
    Math.min(1, tint * BUTTERSCOTCH[1] * k + own * share(g) * target),
    Math.min(1, tint * BUTTERSCOTCH[2] * k + own * share(b) * target),
  ];
}

/** Grades RGBA pixels in place. */
export function gradePixels(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const c = gradeColour((rgba[i] ?? 0) / 255, (rgba[i + 1] ?? 0) / 255, (rgba[i + 2] ?? 0) / 255);
    rgba[i] = c[0] * 255;
    rgba[i + 1] = c[1] * 255;
    rgba[i + 2] = c[2] * 255;
  }
}
