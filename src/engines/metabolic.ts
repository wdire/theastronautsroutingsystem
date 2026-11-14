/**
 * How hard a suited walker works, and the oxygen that takes. Modelled.
 *
 * Uphill and level: the load-carriage equation of Pandolf, Givoni and Goldman (1977), J. Appl. Physiol. 43.
 * Downhill: the correction of Santee et al. (2001), which makes a gentle descent cheaper than the flat and a
 * steep one dearer because the legs brake. The result is scaled for a pressurised suit at Mars gravity.
 */

/** Body mass of one walker, kg (build spec). */
const BODY_KG = 75;
/** Mass of the suit and life support carried, kg (build spec). */
const SUIT_KG = 45;
/** Pandolf terrain factor for loose, uneven ground (build spec; Pandolf lists 1.1 for a dirt road and 1.2 for light brush). */
const TERRAIN = 1.2;
/** Net effect of Mars gravity (less weight to carry) and of working against a pressurised suit (build spec; an assumption, there is no measurement on Mars). */
const SUIT_MARS_FACTOR = 0.68;
/** The steepest descent Santee et al. measured, percent grade. Past it their fit is carried on in a straight line (assumption): its squared term otherwise runs to several kilowatts. */
const SANTEE_LIMIT_PCT = 12;

/** Work rate riding in a rover seat, W (build spec; Apollo crews ran at about 120 to 150 W on the lunar rover). */
export const SEATED_W = 150;
/** Work rate doing science at a stop, W (build spec; near the Apollo surface average of about 270 W). */
export const WORK_W = 300;
/** Work rate standing still in the suit, W: the Pandolf equation at zero speed, scaled like walking. About 135 W. */
export const STANDING_W = SUIT_MARS_FACTOR * pandolfW(0, 0);

/** Oxygen used at 250 W, kg per hour (build spec). About a fifth more than the 0.061 kg/h a body burns at 250 W, which leaves room for suit leakage. */
const O2_KG_PER_HOUR_AT_250W = 0.075;

/** Pandolf et al. (1977): M = 1.5 W + 2.0 (W + L)(L / W)^2 + n (W + L)(1.5 V^2 + 0.35 V G), V in m/s, G in percent. */
function pandolfW(speedMs: number, gradePct: number): number {
  const total = BODY_KG + SUIT_KG;
  return (
    1.5 * BODY_KG +
    2.0 * total * (SUIT_KG / BODY_KG) ** 2 +
    TERRAIN * total * (1.5 * speedMs * speedMs + 0.35 * speedMs * gradePct)
  );
}

/** Santee et al. (2001) downhill correction: CF = n [G (W + L) V / 3.5 - (W + L)(G + 6)^2 / W + (25 - V^2)], G negative. */
function santeeCorrectionW(speedMs: number, gradePct: number): number {
  const total = BODY_KG + SUIT_KG;
  return (
    TERRAIN * ((gradePct * total * speedMs) / 3.5 - (total * (gradePct + 6) ** 2) / BODY_KG + (25 - speedMs * speedMs))
  );
}

/**
 * Pandolf minus Santee's correction for a descent. The correction is shifted so that it is zero on the flat
 * (assumption): as published it leaves a 40 W step between level ground and the slightest descent.
 */
function downhillW(speedMs: number, gradePct: number): number {
  const g = Math.max(gradePct, -SANTEE_LIMIT_PCT);
  const atG = pandolfW(speedMs, g) - (santeeCorrectionW(speedMs, g) - santeeCorrectionW(speedMs, 0));
  if (gradePct >= -SANTEE_LIMIT_PCT) return atG;
  const total = BODY_KG + SUIT_KG;
  // Slope of the corrected cost with grade at the edge of Santee's data, W per percent (negative: steeper costs more).
  const slope =
    TERRAIN * total * 0.35 * speedMs -
    TERRAIN * ((total * speedMs) / 3.5 - (2 * total * (-SANTEE_LIMIT_PCT + 6)) / BODY_KG);
  return atG + slope * (gradePct + SANTEE_LIMIT_PCT);
}

/**
 * Metabolic rate of one suited walker, W, at a speed (km/h) on a signed grade (degrees, uphill positive).
 * Never below standing. Flat ground at 3.3 km/h is about 259 W.
 */
export function walkingW(speedKmh: number, gradeDeg: number): number {
  const v = Number.isFinite(speedKmh) && speedKmh > 0 ? speedKmh / 3.6 : 0;
  const deg = Number.isFinite(gradeDeg) ? Math.max(-60, Math.min(60, gradeDeg)) : 0;
  const gradePct = 100 * Math.tan((deg * Math.PI) / 180);
  const raw = gradePct >= 0 ? pandolfW(v, gradePct) : downhillW(v, gradePct);
  return Math.max(STANDING_W, SUIT_MARS_FACTOR * raw);
}

/** Oxygen one person uses at a work rate, kg per hour: 0.075 kg/h at 250 W, in proportion. */
export function o2KgPerHour(watts: number): number {
  return watts > 0 ? (O2_KG_PER_HOUR_AT_250W * watts) / 250 : 0;
}
