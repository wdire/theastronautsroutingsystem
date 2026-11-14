/**
 * Conditions on the ground: temperature, pressure, dust, radiation dose, visibility, meteor showers.
 *
 * Everything in this file is MODELLED, not measured. Each model is a simple curve tied to a published
 * measurement at one or two places; the comments say which. The UI labels these numbers "modelled".
 * Pure functions: the time always comes in as an argument.
 */
import { MARS_G, REGION_CENTER } from '../lib/constants';
import { distanceM } from '../lib/geo';
import { marsTime, solarDeclinationDeg, sunDistanceAu, sunPosition } from './marsTime';
import type { Conditions, Scenario } from './types';

const RAD = Math.PI / 180;

/** Clear sky, quiet sun, the middle of the solar cycle. */
export const DEFAULT_SCENARIO: Scenario = { dust: 'clear', solarEvent: false, solarCycle: 0.5 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Smallest angle between two directions on a 360 degree dial. */
function lsGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* ---------- pressure ---------- */

/** Mean surface pressure at the MOLA datum, Pa. Fixed by the build spec; close to the 610 Pa triple-point datum. */
export const DATUM_PRESSURE_PA = 560;
/** Pressure scale height, m. Fixed by the build spec; the usual value for a 210 K CO2 atmosphere. */
export const SCALE_HEIGHT_M = 11_100;

/**
 * Seasonal swing of surface pressure as a fraction of the annual mean: a sixth of the air freezes onto the
 * winter pole and comes back. Two harmonics set by eye (approximate) to the Viking Lander and Curiosity REMS
 * records (Hess et al. 1980; Haberle et al. 2014): lowest near Ls 150, highest near Ls 255.
 */
function seasonalPressureFactor(lsDeg: number): number {
  return 1 + 0.06 * Math.cos((lsDeg - 290) * RAD) + 0.065 * Math.cos(2 * (lsDeg - 65) * RAD);
}

/**
 * Surface pressure, Pa: 560 Pa at the datum falling by 1/e every 11.1 km. With a date the seasonal CO2
 * cycle is applied; without one this is the annual mean.
 */
export function pressurePa(elev: number, utcMs?: number): number {
  const mean = DATUM_PRESSURE_PA * Math.exp(-elev / SCALE_HEIGHT_M);
  return utcMs === undefined ? mean : mean * seasonalPressureFactor(marsTime(utcMs, 0).lsDeg);
}

/* ---------- dust ---------- */

/** Optical depth of the sky in the clear season (assumption, after the lowest Mars Exploration Rover values). */
const TAU_FLOOR = 0.35;
/** Optical depth in a planet-encircling storm (assumption): the 2007 storm reached about 4.5 to 5 at the MER sites (Lemmon et al. 2015); 2018 went higher. */
export const GLOBAL_STORM_TAU = 5;
/** Extra optical depth at the centre of a regional storm (assumption). */
export const REGIONAL_STORM_TAU = 2;
/** Where a regional storm sits when the scenario gives no centre: the middle of the region, 150 km wide (assumption). */
const DEFAULT_STORM = { lon: REGION_CENTER[0], lat: REGION_CENTER[1], radiusKm: 150 };

/**
 * Dust optical depth by season with no storm: low through northern spring and summer, a broad peak near
 * Ls 235 and a second near Ls 325. Two bumps set by eye (approximate) to the five-Mars-year Mars Exploration
 * Rover record in Lemmon et al. (2015), Icarus 251.
 */
function seasonalTau(lsDeg: number): number {
  const bump = (centre: number, width: number) => Math.exp(-0.5 * (lsGap(lsDeg, centre) / width) ** 2);
  return TAU_FLOOR + 0.55 * bump(235, 35) + 0.35 * bump(325, 22);
}

/** Dust optical depth of the sky over a place, for the season and the what-if scenario. */
export function tauAt(lat: number, lon: number, utcMs: number, scenario: Scenario): number {
  const base = seasonalTau(marsTime(utcMs, 0).lsDeg);
  if (scenario.dust === 'globalStorm') return Math.max(base, GLOBAL_STORM_TAU);
  if (scenario.dust === 'regionalStorm') {
    const storm = scenario.storm ?? DEFAULT_STORM;
    const radiusM = Math.max(1, storm.radiusKm * 1000);
    const d = distanceM(lon, lat, storm.lon, storm.lat) / radiusM;
    // Thickest at the centre, fading smoothly to the seasonal sky at the edge (assumption).
    if (d < 1) return base + REGIONAL_STORM_TAU * (1 - d * d) ** 2;
  }
  return base;
}

/**
 * How far you can see along the ground, km. Koschmieder's rule (visual range = 3.912 / extinction) with the
 * dust mixed evenly through one scale height, so extinction = tau / 11.1 km (approximate). Capped at 300 km.
 */
export function visibilityKm(tau: number): number {
  const t = Number.isFinite(tau) ? tau : 0;
  if (t <= 0) return 300;
  return Math.min(300, (3.912 * (SCALE_HEIGHT_M / 1000)) / t);
}

/* ---------- temperature ---------- */

/** Daily mean air temperature on the Jezero floor at the equinox, K. Calibrated so the day runs from about -20 C to -84 C, as Perseverance MEDA measured (Rodriguez-Manfredi et al. 2023). */
const T_REF_K = 218;
/** Day-mean sunlight factor at Jezero at the equinox (cos of latitude / pi / distance squared); the calibration point for T_REF_K. */
const INSOLATION_REF = 0.1243;
/** Noon sunlight factor at Jezero at the equinox; the calibration point for the day-night swing. */
const NOON_REF = 0.39;
/** Half the day-night swing of air temperature at Jezero under a clear sky, K (MEDA, approximate). */
const SWING_K = 32;
/** CO2 frost point at Mars surface pressure, K: the air cannot get colder while CO2 is condensing. */
const FROST_K = 148;
/** Cooling with height, K per km (assumption): far less than the 4.5 K/km of free air, because near-surface air follows the sunlit ground. */
const LAPSE_K_PER_KM = 1;
/** Elevation the calibration refers to: the Jezero crater floor, m. */
const T_REF_ELEV_M = -2500;
/** Local solar hours of the coldest and warmest air (MEDA: coldest just before sunrise, warmest early afternoon). */
const COLDEST_H = 5.5;
const WARMEST_H = 14;
/** How fast the swing shrinks with dust (approximate): about half at tau 5, as Curiosity REMS saw in the 2018 global storm (Guzewich et al. 2019). */
const DUST_DAMPING = 0.25;

/** Shape of the day, -1 at the coldest hour to +1 at the warmest: a quick morning rise, then a long cooling that is fastest after sunset. */
function diurnalShape(ltstH: number): number {
  const sinceCold = (((ltstH - COLDEST_H) % 24) + 24) % 24;
  const riseH = WARMEST_H - COLDEST_H;
  if (sinceCold <= riseH) return -1 + 2 * Math.sin((Math.PI / 2) * (sinceCold / riseH)) ** 2;
  const x = (sinceCold - riseH) / (24 - riseH);
  return -1 + 2 * Math.cos((Math.PI / 2) * x ** 0.75) ** 2;
}

/** Day average of diurnalShape, so the swing is centred on the daily mean. */
const DIURNAL_MEAN = (() => {
  let sum = 0;
  const n = 960;
  for (let i = 0; i < n; i++) sum += diurnalShape(((i + 0.5) * 24) / n);
  return sum / n;
})();

/**
 * Air temperature about 1.5 m above the ground, degrees C.
 * The daily mean follows the sunlight a level surface collects over the sol (latitude, season, distance from
 * the sun) to the power 1/4, as for a body in radiative balance. The day-night swing follows the noon sun and
 * shrinks under dust. Longitude sets the local hour and whether a regional storm is overhead.
 */
export function temperatureC(lat: number, lon: number, elev: number, utcMs: number, scenario: Scenario): number {
  const phi = clamp(lat, -90, 90) * RAD;
  const dec = solarDeclinationDeg(utcMs) * RAD;
  const r2 = sunDistanceAu(utcMs) ** 2;
  const sinSin = Math.sin(phi) * Math.sin(dec);
  const cosCos = Math.cos(phi) * Math.cos(dec);
  // Half the daylight arc; 0 in polar night, pi in polar day.
  const h0 = Math.acos(clamp(cosCos > 1e-12 ? -sinSin / cosCos : sinSin > 0 ? -1 : 1, -1, 1));
  const dayMean = Math.max(0, (h0 * sinSin + cosCos * Math.sin(h0)) / Math.PI) / r2;
  const noon = Math.max(0, sinSin + cosCos) / r2;

  const meanK = T_REF_K * (dayMean / INSOLATION_REF) ** 0.25;
  const tau = tauAt(lat, lon, utcMs, scenario);
  const damping = 1 / (1 + DUST_DAMPING * Math.max(0, tau - 0.5));
  const swingK = SWING_K * Math.min(1.25, Math.sqrt(noon / NOON_REF)) * damping;
  const shape = diurnalShape(marsTime(utcMs, lon).ltstH) - DIURNAL_MEAN;
  const lapseK = (LAPSE_K_PER_KM * (elev - T_REF_ELEV_M)) / 1000;
  return Math.max(FROST_K, meanK + swingK * shape - lapseK) - 273.15;
}

/* ---------- radiation ---------- */

/**
 * Dose equivalent on the ground at Gale crater from galactic cosmic rays, mSv per sol. Curiosity RAD measured
 * 0.64 +/- 0.12 mSv per day in 2012-13 (Hassler et al. 2014, Science 343). The build spec uses it per sol; the
 * 3% difference between a day and a sol is well inside the error bar.
 */
export const RAD_GALE_MSV_PER_SOL = 0.64;
/** Elevation of Curiosity's landing site, m (about -4,500 m on the MOLA areoid). */
export const GALE_ELEV_M = -4500;
/** Air overhead at Gale at the annual mean pressure, g/cm2: pressure / gravity. About 22.6. */
const GALE_COLUMN = columnGcm2(DATUM_PRESSURE_PA * Math.exp(-GALE_ELEV_M / SCALE_HEIGHT_M));
/** Air needed to cut the cosmic-ray dose by 1/e, g/cm2 (approximate): between RAD's own response to daily pressure changes (Rafkin et al. 2014) and model maps of dose against altitude (Saganti et al. 2004). */
const GCR_ATTENUATION_GCM2 = 50;
/** Cosmic-ray dose at solar minimum against mid-cycle (approximate): RAD's dose rate rose by about 45% from 2013 to the 2019-20 solar minimum. */
const SOLAR_MIN_FACTOR = 1.45;
/** Cosmic-ray dose at a strong solar maximum against mid-cycle (assumption). */
const SOLAR_MAX_FACTOR = 0.6;
/** Extra dose at Gale during a solar particle event, mSv per sol (assumption): a strong event, about three times the quiet total. The largest event RAD has seen on the ground, September 2017, roughly doubled the dose rate for a day (Zeitlin et al. 2018). */
const SPE_GALE_MSV_PER_SOL = 1.3;
/** Air needed to cut the particle-event dose by 1/e, g/cm2 (assumption): solar particles are softer than cosmic rays, so air stops them sooner. */
const SPE_ATTENUATION_GCM2 = 20;

function columnGcm2(pressure: number): number {
  return pressure / MARS_G / 10; // Pa / (m/s2) = kg/m2; 10 kg/m2 = 1 g/cm2
}

/** RAD's 2012-13 measurement fell in a weak solar maximum with middling shielding by the solar wind, so it is taken as the mid-cycle value (assumption). */
function solarCycleFactor(solarCycle: number): number {
  const s = clamp(Number.isFinite(solarCycle) ? solarCycle : 0.5, 0, 1);
  return s <= 0.5 ? SOLAR_MIN_FACTOR + (1 - SOLAR_MIN_FACTOR) * (s / 0.5) : 1 + (SOLAR_MAX_FACTOR - 1) * ((s - 0.5) / 0.5);
}

/**
 * Radiation dose equivalent, mSv per sol: the RAD value at Gale, scaled by the mass of air overhead (less air
 * higher up, and less in the low-pressure season), the solar cycle, a solar particle event if one is under
 * way, and the fraction that gets through the vehicle's shielding (1 = none).
 */
export function doseMSvPerSol(elev: number, utcMs: number, scenario: Scenario, doseFactor = 1): number {
  const column = columnGcm2(pressurePa(elev, utcMs));
  const gcr = RAD_GALE_MSV_PER_SOL * solarCycleFactor(scenario.solarCycle) * Math.exp(-(column - GALE_COLUMN) / GCR_ATTENUATION_GCM2);
  const spe = scenario.solarEvent ? SPE_GALE_MSV_PER_SOL * Math.exp(-(column - GALE_COLUMN) / SPE_ATTENUATION_GCM2) : 0;
  return (gcr + spe) * clamp(doseFactor, 0, 1);
}

/* ---------- everything at once ---------- */

/** All modelled conditions for one place and moment. */
export function conditionsAt(lat: number, lon: number, elev: number, utcMs: number, scenario: Scenario): Conditions {
  const tau = tauAt(lat, lon, utcMs, scenario);
  const sun = sunPosition(utcMs, lat, lon);
  return {
    tempC: temperatureC(lat, lon, elev, utcMs, scenario),
    pressurePa: pressurePa(elev, utcMs),
    tau,
    doseMSvPerSol: doseMSvPerSol(elev, utcMs, scenario),
    visibilityKm: visibilityKm(tau),
    sunElevDeg: sun.elevDeg,
    sunAzDeg: sun.azDeg,
    ltstH: marsTime(utcMs, lon).ltstH,
  };
}

/* ---------- meteor showers ---------- */

interface ShowerEntry {
  name: string;
  parent: string;
  lsDeg: number;
  note: string;
  /** Set for a one-off encounter: the only Mars year it happened in. */
  onlyMarsYear?: number;
}

/** A yearly shower counts as active within this many degrees of solar longitude of its peak, about five to nine days (assumption). */
const SHOWER_WINDOW_LS = 3;
/** A one-off encounter counts as active within this many degrees, about a day (assumption). */
const ENCOUNTER_WINDOW_LS = 0.6;

/**
 * Meteor showers at Mars are predictions from comet orbits; none is confirmed as a yearly event. Solar
 * longitudes here are approximate: the two dated events are this module's Mars time for the date of the
 * observation, the two predicted ones are where Mars passes closest to the comet's orbit (Christou 2010,
 * MNRAS 402, names both comets as candidates).
 */
const SHOWERS: readonly ShowerEntry[] = [
  {
    name: 'Wiseman-Skiff meteors',
    parent: '114P/Wiseman-Skiff',
    lsDeg: 0.7,
    note: 'Candidate. Spirit photographed a streak in the sky on 7 March 2004 that Selsis et al. (2005) linked to this comet. Date approximate.',
  },
  {
    name: 'Olbers meteors',
    parent: '13P/Olbers',
    lsDeg: 1,
    note: "Predicted, not yet seen. Mars passes close to the comet's orbit near this date. Date approximate.",
  },
  {
    name: 'du Toit-Hartley meteors',
    parent: '79P/du Toit-Hartley',
    lsDeg: 172,
    note: "Predicted. A layer of meteor metals that Mars Global Surveyor saw high in the air in April 2003 was linked to this comet's dust (Christou et al. 2007). Date approximate, to within about 8 degrees.",
  },
  {
    name: 'Halley meteors',
    parent: '1P/Halley',
    lsDeg: 325,
    note: "Predicted, not yet seen. Mars passes close to Halley's orbit near this date. Date approximate.",
  },
  {
    name: 'Siding Spring meteor storm',
    parent: 'C/2013 A1 (Siding Spring)',
    lsDeg: 217.4,
    onlyMarsYear: 32,
    note: 'One-off, 19 October 2014. The comet passed about 140,000 km from Mars and MAVEN saw meteor metals pile up high in the air for days. Not expected to repeat.',
  },
];

/** Known and predicted meteor showers at Mars, each marked active if the date falls in its window. */
export function meteorShowers(utcMs: number): { name: string; parent: string; lsDeg: number; active: boolean; note: string }[] {
  const now = marsTime(utcMs, 0);
  return SHOWERS.map((s) => {
    const active =
      s.onlyMarsYear === undefined
        ? lsGap(now.lsDeg, s.lsDeg) <= SHOWER_WINDOW_LS
        : now.marsYear === s.onlyMarsYear && lsGap(now.lsDeg, s.lsDeg) <= ENCOUNTER_WINDOW_LS;
    return { name: s.name, parent: s.parent, lsDeg: s.lsDeg, active, note: s.note };
  });
}
