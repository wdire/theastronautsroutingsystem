/**
 * Mars time and the sun’s place in the Martian sky.
 *
 * The Mars24 algorithm: Allison and McEwen (2000), "A post-Pathfinder evaluation of areocentric solar
 * coordinates with improved timing recipes for Mars seasonal/diurnal climate studies", Planetary and Space
 * Science 48, 215-235, with the updated coefficients NASA GISS publishes for Mars24. Equation numbers in the
 * comments (A-1, B-4, ...) follow the GISS write-up of the algorithm.
 *
 * Longitudes are east-positive degrees. Times are UTC milliseconds since the Unix epoch. Nothing here reads
 * the system clock.
 */
import { SOL_S } from '../lib/constants';

export interface MarsTime {
  /** Mars Sol Date: sols counted from 1873-12-29, the Mars24 convention. */
  msd: number;
  /** Whole part of the Mars Sol Date. */
  sol: number;
  /** Local true solar time, hours 0 to 24. */
  ltstH: number;
  /** Local mean solar time, hours 0 to 24. */
  lmstH: number;
  /** Areocentric solar longitude, the season: 0 northern spring equinox, 90 summer solstice. */
  lsDeg: number;
  /** Mars year in the Clancy et al. (2000) count: year 1 began at Ls 0 on 1955-04-11. */
  marsYear: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;
export const SOL_MS = SOL_S * 1000;
const SOL_HOUR_MS = SOL_MS / 24;

/** A-1: Julian Date of the Unix epoch. */
const JD_UNIX_EPOCH = 2440587.5;
/** A-6: Julian Date (TT) of the J2000 epoch. */
const JD_J2000 = 2451545.0;
/** C-2: length of a sol in Earth days (Allison and McEwen 2000). */
const SOL_IN_DAYS = 1.0274912517;
/** Mean Mars tropical year in Earth days (Allison and McEwen 2000); used only for first guesses. */
const MARS_YEAR_DAYS = 686.9726;
/** Seconds of light travel per astronomical unit: IAU 2012 au over the speed of light. */
const LIGHT_S_PER_AU = 149_597_870.7 / 299_792.458;
/** Mars year under way at J2000 (Clancy et al. 2000 count: year 24 began 1998-07-14). */
const MARS_YEAR_AT_J2000 = 24;

/**
 * A-5: TAI minus UTC, seconds, from the date each leap second took effect (IERS Bulletin C).
 * TT is TAI + 32.184 s. No leap second has been added since 2017.
 */
const LEAP_SECONDS: readonly (readonly [utcMs: number, taiMinusUtc: number])[] = [
  [Date.UTC(1972, 0, 1), 10],
  [Date.UTC(1972, 6, 1), 11],
  [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14],
  [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16],
  [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19],
  [Date.UTC(1981, 6, 1), 20],
  [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22],
  [Date.UTC(1985, 6, 1), 23],
  [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26],
  [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28],
  [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31],
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

/** B-3: the seven largest planetary perturbations: amplitude (deg), period (years), phase (deg). */
const PERTURBERS: readonly (readonly [amp: number, tau: number, phi: number])[] = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Signed shortest way from one reading to another on a dial of the given size. */
function wrapSigned(v: number, size: number): number {
  return mod(v + size / 2, size) - size / 2;
}

function ttMinusUtcS(utcMs: number): number {
  let tai = 10; // before 1972 UTC was not stepped in whole seconds; 10 s is the 1972 value (approximate)
  for (const [from, seconds] of LEAP_SECONDS) {
    if (utcMs >= from) tai = seconds;
    else break;
  }
  return tai + 32.184;
}

interface Orbit {
  /** Days since J2000, Terrestrial Time. */
  dt: number;
  jdTT: number;
  /** B-1: Mars mean anomaly, degrees (not wrapped). */
  meanAnomalyDeg: number;
  /** B-4: equation of centre, true minus mean anomaly, degrees. */
  nuMinusM: number;
  /** B-5 before wrapping: grows by 360 each Mars year. */
  lsUnwrappedDeg: number;
  lsDeg: number;
  /** C-1: equation of time, degrees. */
  eotDeg: number;
}

function orbit(utcMs: number): Orbit {
  const jdUT = JD_UNIX_EPOCH + utcMs / MS_PER_DAY; // A-1
  const jdTT = jdUT + ttMinusUtcS(utcMs) / 86_400; // A-5
  const dt = jdTT - JD_J2000; // A-6
  const meanAnomalyDeg = 19.3871 + 0.52402073 * dt; // B-1
  const alphaFms = 270.3871 + 0.524038496 * dt; // B-2: angle of the fictitious mean sun
  let pbs = 0; // B-3
  for (const [amp, tau, phi] of PERTURBERS) pbs += amp * Math.cos(((0.985626 * dt) / tau + phi) * RAD);
  const m = meanAnomalyDeg * RAD;
  const nuMinusM = // B-4
    (10.691 + 3.0e-7 * dt) * Math.sin(m) +
    0.623 * Math.sin(2 * m) +
    0.05 * Math.sin(3 * m) +
    0.005 * Math.sin(4 * m) +
    0.0005 * Math.sin(5 * m) +
    pbs;
  const lsUnwrappedDeg = alphaFms + nuMinusM; // B-5
  const lsDeg = mod(lsUnwrappedDeg, 360);
  const ls = lsDeg * RAD;
  const eotDeg = 2.861 * Math.sin(2 * ls) - 0.071 * Math.sin(4 * ls) + 0.002 * Math.sin(6 * ls) - nuMinusM; // C-1
  return { dt, jdTT, meanAnomalyDeg, nuMinusM, lsUnwrappedDeg, lsDeg, eotDeg };
}

function fromOrbit(o: Orbit, lonE: number): MarsTime {
  const msd = (o.jdTT - 2451549.5) / SOL_IN_DAYS + 44796.0 - 0.0009626; // C-2
  const mtc = mod(24 * msd, 24); // C-2: Coordinated Mars Time at the prime meridian
  const lmstH = mod(mtc + lonE / 15, 24); // C-3, with east longitude added instead of west subtracted
  const ltstH = mod(lmstH + o.eotDeg / 15, 24); // C-4
  return {
    msd,
    sol: Math.floor(msd),
    ltstH,
    lmstH,
    lsDeg: o.lsDeg,
    marsYear: MARS_YEAR_AT_J2000 + Math.floor(o.lsUnwrappedDeg / 360),
  };
}

/** Mars Sol Date, local solar times at a longitude, season and Mars year for a moment. */
export function marsTime(utcMs: number, lonE: number): MarsTime {
  return fromOrbit(orbit(utcMs), lonE);
}

/** D-1: the latitude where the sun is overhead, degrees (planetographic), from the season. */
function declinationDeg(lsDeg: number): number {
  const s = Math.sin(lsDeg * RAD);
  return Math.asin(0.42565 * s) * DEG + 0.25 * s;
}

/** The latitude where the sun is overhead at a moment, degrees. */
export function solarDeclinationDeg(utcMs: number): number {
  return declinationDeg(orbit(utcMs).lsDeg);
}

/** D-2: distance from the sun to Mars, astronomical units. */
function marsSunAu(o: Orbit): number {
  const m = o.meanAnomalyDeg * RAD;
  return (
    1.52367934 *
    (1.00436 - 0.09309 * Math.cos(m) - 0.004336 * Math.cos(2 * m) - 0.00031 * Math.cos(3 * m) - 0.00003 * Math.cos(4 * m))
  );
}

/** Distance from the sun to Mars at a moment, astronomical units (1.38 at perihelion, 1.67 at aphelion). */
export function sunDistanceAu(utcMs: number): number {
  return marsSunAu(orbit(utcMs));
}

/**
 * Where the sun is in the sky. Elevation is the centre of the disc above a level horizon with no
 * refraction (D-5); azimuth is clockwise from north (D-6, rewritten for east-positive longitude).
 */
export function sunPosition(utcMs: number, lat: number, lonE: number): { elevDeg: number; azDeg: number } {
  const o = orbit(utcMs);
  const t = fromOrbit(o, lonE);
  const dec = declinationDeg(o.lsDeg) * RAD;
  const phi = lat * RAD;
  const hourAngle = (t.ltstH - 12) * 15 * RAD; // zero at local noon, positive in the afternoon
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  const elevDeg = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  const east = -Math.cos(dec) * Math.sin(hourAngle);
  const north = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(hourAngle);
  return { elevDeg, azDeg: mod(Math.atan2(east, north) * DEG, 360) };
}

/** The moment of local true noon in the local solar day (LTST 0 to 24) that contains utcMs. */
function localNoon(utcMs: number, lonE: number): number {
  let noon = utcMs + (12 - marsTime(utcMs, lonE).ltstH) * SOL_HOUR_MS;
  // A true solar day differs from a mean sol by up to a minute; two corrections reach milliseconds.
  for (let i = 0; i < 2; i++) noon += (12 - marsTime(noon, lonE).ltstH) * SOL_HOUR_MS;
  return noon;
}

/** Moves a first guess to the moment the sun’s centre crosses the horizon (Newton steps on elevation). */
function refineHorizon(guessMs: number, lat: number, lonE: number): number {
  let t = guessMs;
  for (let i = 0; i < 4; i++) {
    const el = sunPosition(t, lat, lonE).elevDeg;
    const rate = (sunPosition(t + 30_000, lat, lonE).elevDeg - el) / 30_000; // degrees per ms
    if (Math.abs(rate) < 1e-9) break; // the sun is grazing the horizon; keep the estimate
    const step = -el / rate;
    t += Math.max(-SOL_HOUR_MS, Math.min(SOL_HOUR_MS, step));
    if (Math.abs(step) < 1) break;
  }
  return t;
}

/**
 * Sunrise and sunset of the local solar day (LTST 0 to 24) that contains utcMs: the moments the centre of
 * the sun crosses a level horizon, no refraction. In polar night both are local noon and the day length is
 * 0; in polar day they are half a sol either side of noon and the day length is a whole sol.
 */
export function sunriseSunset(
  utcMs: number,
  lat: number,
  lonE: number,
): { riseUtcMs: number; setUtcMs: number; dayLengthS: number } {
  const noon = localNoon(utcMs, lonE);
  const dec = solarDeclinationDeg(noon) * RAD;
  const cosH0 = -Math.tan(lat * RAD) * Math.tan(dec);
  if (cosH0 >= 1) return { riseUtcMs: noon, setUtcMs: noon, dayLengthS: 0 };
  if (cosH0 <= -1) return { riseUtcMs: noon - SOL_MS / 2, setUtcMs: noon + SOL_MS / 2, dayLengthS: SOL_S };
  const halfDayMs = ((Math.acos(cosH0) * DEG) / 15) * SOL_HOUR_MS;
  const riseUtcMs = refineHorizon(noon - halfDayMs, lat, lonE);
  const setUtcMs = refineHorizon(noon + halfDayMs, lat, lonE);
  return { riseUtcMs, setUtcMs, dayLengthS: (setUtcMs - riseUtcMs) / 1000 };
}

/**
 * The first sunrise at or after utcMs. Where the sun does not rise (polar night) this is the next local
 * noon, so check sunriseSunset().dayLengthS before waiting for it.
 */
export function nextSunrise(utcMs: number, lat: number, lonE: number): number {
  const today = sunriseSunset(utcMs, lat, lonE);
  if (today.dayLengthS > 0 && today.riseUtcMs >= utcMs) return today.riseUtcMs;
  const noon = (today.riseUtcMs + today.setUtcMs) / 2;
  return sunriseSunset(noon + SOL_MS, lat, lonE).riseUtcMs;
}

/**
 * One-way light time between Earth and Mars, seconds. Mars from Mars24 (D-2 to D-4). Earth from the
 * low-precision solar coordinates in Meeus, "Astronomical Algorithms" (1998), chapter 25. Good to a few
 * seconds (approximate: the two series use slightly different reference frames).
 */
export function lightTimeS(utcMs: number): number {
  const o = orbit(utcMs);
  const ls = o.lsDeg;
  const rMars = marsSunAu(o); // D-2
  const lMars = ls + 85.061 - 0.015 * Math.sin((71 + 2 * ls) * RAD) - 5.5e-6 * o.dt; // D-3, J2000 ecliptic
  const bMars = -(1.8497 - 2.23e-5 * o.dt) * Math.sin((ls - 144.5 + 2.57e-6 * o.dt) * RAD); // D-4

  const T = o.dt / 36_525; // Julian centuries since J2000
  const l0 = 280.46646 + 36_000.76983 * T + 0.0003032 * T * T; // Meeus 25.2: sun’s mean longitude
  const mEarthDeg = 357.52911 + 35_999.05029 * T - 0.0001537 * T * T; // Meeus 25.3: sun’s mean anomaly
  const mEarth = mEarthDeg * RAD;
  const e = 0.016708634 - 0.000042037 * T; // Meeus 25.4: eccentricity of Earth’s orbit
  const centre =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(mEarth) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * mEarth) +
    0.000289 * Math.sin(3 * mEarth);
  const rEarth = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos((mEarthDeg + centre) * RAD)); // Meeus 25.5
  // Earth is opposite the sun as seen from Earth. 1.397 deg per century turns the equinox of date to J2000.
  const lEarth = l0 + centre + 180 - 1.397 * T;

  const cosSep = Math.cos(bMars * RAD) * Math.cos((lMars - lEarth) * RAD);
  const distAu = Math.sqrt(Math.max(0, rEarth * rEarth + rMars * rMars - 2 * rEarth * rMars * cosSep));
  return distAu * LIGHT_S_PER_AU;
}

/** The first moment at or after afterUtcMs when the season reaches the given solar longitude. */
export function dateForLs(lsDeg: number, afterUtcMs: number): number {
  const target = mod(lsDeg, 360);
  const meanRate = 360 / MARS_YEAR_DAYS; // degrees per Earth day
  const ahead = mod(target - orbit(afterUtcMs).lsDeg, 360);
  if (ahead < 1e-9) return afterUtcMs;
  let t = afterUtcMs + (ahead / meanRate) * MS_PER_DAY;
  // Ls runs between 0.34 and 0.63 degrees a day, so Newton steps with the local rate settle quickly.
  for (let i = 0; i < 30; i++) {
    const here = orbit(t).lsUnwrappedDeg;
    const rate = orbit(t + MS_PER_DAY).lsUnwrappedDeg - here;
    const err = wrapSigned(target - mod(here, 360), 360);
    t += (err / rate) * MS_PER_DAY;
    if (Math.abs(err) < 1e-9) break;
  }
  return Math.max(t, afterUtcMs);
}

/** The first moment at or after utcMs when local true solar time at the longitude reads ltstH. */
export function nextLtst(utcMs: number, lonE: number, ltstH: number): number {
  const target = mod(ltstH, 24);
  let t = utcMs + mod(target - marsTime(utcMs, lonE).ltstH, 24) * SOL_HOUR_MS;
  for (let i = 0; i < 3; i++) t += wrapSigned(target - marsTime(t, lonE).ltstH, 24) * SOL_HOUR_MS;
  return Math.max(t, utcMs);
}
