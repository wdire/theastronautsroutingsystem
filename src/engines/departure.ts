/**
 * When to leave so a trip ends in daylight. Pure: the planned time comes in as an argument.
 */
import { nextSunrise, SOL_MS, sunPosition, sunriseSunset } from './marsTime';

/** Time after sunrise before setting off, for the light to come up and the ground to be seen, ms (build spec). */
export const AFTER_SUNRISE_MS = 30 * 60_000;
/** Light kept in hand at the end of the trip, ms (build spec). */
export const BEFORE_SUNSET_MS = 15 * 60_000;
/** How many sols ahead to look for a day long enough (assumption): days change slowly, so a few is plenty. */
const SEARCH_SOLS = 5;

export interface Departure {
  departUtcMs: number;
  /** The trip fits between the start and 15 minutes before sunset. */
  fits: boolean;
  /** The departure differs from the one planned. */
  moved: boolean;
}

/**
 * The planned departure if a trip of durationS seconds leaving then starts and ends in the same day's
 * light, with 15 minutes in hand before sunset. Otherwise the first
 * start 30 minutes after a sunrise from which the trip ends 15 minutes before that day's sunset. If no
 * day ahead is long enough (or the sun does not rise), the start 30 minutes after the next sunrise, with
 * fits false.
 */
export function daylightDeparture(plannedUtcMs: number, durationS: number, lat: number, lon: number): Departure {
  const planned = Number.isFinite(plannedUtcMs) ? plannedUtcMs : 0;
  const tripMs = Number.isFinite(durationS) && durationS > 0 ? durationS * 1000 : 0;

  // Left alone only if the whole trip is in one day's light: the sun is up at the start, still up at
  // the end with the margin in hand, and no night falls in between.
  const lightMs = sunriseSunset(planned, lat, lon).dayLengthS * 1000;
  const inOneDay = tripMs + BEFORE_SUNSET_MS < lightMs;
  if (inOneDay && sunPosition(planned, lat, lon).elevDeg > 0 && sunPosition(planned + tripMs + BEFORE_SUNSET_MS, lat, lon).elevDeg > 0) {
    return { departUtcMs: planned, fits: true, moved: false };
  }

  let first: number | null = null;
  // A sunrise up to 30 minutes before the plan still gives a start at or after it.
  let probe = planned - AFTER_SUNRISE_MS;
  for (let k = 0; k < SEARCH_SOLS; k += 1) {
    const rise = nextSunrise(probe, lat, lon);
    const day = sunriseSunset(rise, lat, lon);
    // Next search from just past this sunrise: the following one is a sol later.
    probe = rise + 1000;
    if (!(day.dayLengthS > 0)) {
      probe = rise + SOL_MS / 2;
      continue;
    }
    const start = rise + AFTER_SUNRISE_MS;
    if (start < planned) continue;
    first ??= start;
    if (start + tripMs <= day.setUtcMs - BEFORE_SUNSET_MS) return { departUtcMs: start, fits: true, moved: true };
  }
  if (first === null) return { departUtcMs: planned, fits: false, moved: false };
  return { departUtcMs: first, fits: false, moved: first !== planned };
}
