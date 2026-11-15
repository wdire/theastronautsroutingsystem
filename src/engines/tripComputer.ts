/**
 * The trip computer: walks or drives a path with the clock running and keeps the books on time, oxygen,
 * battery, water, radiation dose and temperature. Modelled: every rate comes from vehicles.ts, metabolic.ts
 * and environment.ts, or is an assumption marked here.
 *
 * Pure: the departure time comes in as an argument and nothing reads the system clock. Junk input (no path,
 * one point, repeated points, heights that are not numbers) gives a finite result rather than an exception.
 */
import { MARS_G, SOL_S } from '../lib/constants';
import { distanceM } from '../lib/geo';
import { doseMSvPerSol, tauAt, temperatureC } from './environment';
import { marsTime, nextSunrise, SOL_MS, sunPosition, sunriseSunset } from './marsTime';
import { o2KgPerHour, SEATED_W, STANDING_W, walkingW, WORK_W } from './metabolic';
import type {
  NightStop,
  PathPoint,
  TripLimit,
  TripOptions,
  TripResult,
  TripSample,
  TripState,
  TripWarning,
  Vehicle,
} from './types';
import {
  CRAWL_FRACTION,
  DRIVE_EFFICIENCY,
  ECO_SPEED_FACTOR,
  FLIGHT_W,
  ROLLING_RESISTANCE,
  RTG_W,
  speedMs,
  VEHICLES,
} from './vehicles';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Grade is measured over at least this much ground, so one noisy cell or a boulder does not read as a cliff (build spec). */
const GRADE_BASE_M = 450;
/** Share of oxygen and scrubber time kept back when judging whether the crew can get home (build spec). */
const RESERVE = 0.2;
/** The longest trip simulated against the sun, sols. Past it nobody waits for daylight, so a polar night cannot hang the loop. */
const MAX_TRIP_SOLS = 60;
/** Longest step of the clock while integrating, s: short enough to follow the sun across the sky for the panels. */
const STEP_S = 600;
/** A path whose ends are this close is a loop: the crew can get home by going on as well as by going back (assumption). */
const LOOP_CLOSE_M = 200;
/** Drinking water, litres per person per hour: about 2.5 L a day (NASA planning figure, approximate). */
const DRINK_L_PER_H = 0.1;
/** Water a suit evaporates to keep its wearer cool at 250 W, litres per hour, in proportion to work rate (Apollo backpack sublimators used about 0.5 kg an hour; approximate). */
const SUIT_COOLING_L_PER_H_AT_250W = 0.5;
/** Optical depth of a clear sky, below which dust costs the panels nothing (matches environment.ts). */
const TAU_CLEAR = 0.35;
/** How fast dust dims the panels, per unit of optical depth (assumption, set by eye to the Spirit and Opportunity power records: tau 5 leaves a few percent). */
const PANEL_DUST_LOSS = 0.6;
/** Suits for the walk home: the walkers' suits, fresh from a cabin. */
const SUIT = VEHICLES.foot;

/** The order in which limits are reported when more than one is met: the first is the one that ends a trip soonest in practice. */
const LIMIT_ORDER: readonly TripLimit[] = ['o2', 'battery', 'scrubber', 'slope', 'daylight', 'cold'];

function finite(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

function km(m: number): string {
  return (finite(m) / 1000).toFixed(1);
}

function hours(s: number): string {
  return (finite(s) / 3600).toFixed(1);
}

/** "17:42" local true solar time. */
function clock(ltstH: number): string {
  const minutes = Math.round(finite(ltstH) * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * How long a crew could spend walking home on suit air and scrubbers, keeping the reserve, hours. The map
 * draws its walk-home ring from this. Walkers and a cabin crew set out in fresh suits; an open rover crew
 * have been breathing suit air on the ride out, so on flat ground the ride and the walk share the time in
 * proportion to their speeds. Zero where there is no crew.
 */
export function walkbackLimitHours(v: Vehicle = VEHICLES.foot): number {
  if (v.crew <= 0 || v.kind === 'air') return 0;
  const suitH = (1 - RESERVE) * SUIT.scrubberH;
  if (v.kind === 'walk' || v.cabin) return suitH;
  const ride = Math.max(v.flatSpeedMs, 1e-9);
  return (suitH * ride) / (ride + SUIT.flatSpeedMs);
}

/** Whether the sun is up at a place, and until when it stays up (or stays down). */
function daylight(t: number, lat: number, lon: number): { light: boolean; untilMs: number } {
  const day = sunriseSunset(t, lat, lon);
  if (day.dayLengthS >= SOL_S - 1) return { light: true, untilMs: t + SOL_MS };
  if (day.dayLengthS > 0) {
    // A second in hand at sunset, so a move that ends exactly at sunset does not leave a sliver of day to cross.
    if (t >= day.riseUtcMs && day.setUtcMs - t > 1000) return { light: true, untilMs: day.setUtcMs };
    if (t < day.riseUtcMs) return { light: false, untilMs: day.riseUtcMs };
  }
  const rise = nextSunrise(t + 1000, lat, lon);
  // In polar night nextSunrise gives the next noon with the sun still down: look again a sol later.
  if (rise > t && sunriseSunset(rise, lat, lon).dayLengthS > 0) return { light: false, untilMs: rise };
  return { light: false, untilMs: t + SOL_MS };
}

/** Heights with the gaps filled: a missing height takes the straight line between its finite neighbours. */
function cleanHeights(path: readonly PathPoint[]): Float64Array {
  const n = path.length;
  const out = new Float64Array(n);
  let prev = -1;
  for (let i = 0; i < n; i += 1) {
    const z = path[i]?.[2] ?? Number.NaN;
    if (!Number.isFinite(z)) continue;
    out[i] = z;
    const gap = i - prev;
    if (gap > 1) {
      const from = prev >= 0 ? (out[prev] ?? z) : z;
      for (let k = prev + 1; k < i; k += 1) out[k] = from + ((z - from) * (k - prev)) / gap;
    }
    prev = i;
  }
  const last = prev >= 0 ? (out[prev] ?? 0) : 0;
  for (let k = prev + 1; k < n; k += 1) out[k] = last;
  return out;
}

function emptyResult(departUtcMs: number, v: Vehicle): TripResult {
  return {
    totals: {
      distM: 0,
      durationS: 0,
      movingS: 0,
      workS: 0,
      waitS: 0,
      climbM: 0,
      descentM: 0,
      maxGradeDeg: 0,
      energyKWh: 0,
      solarKWh: 0,
      o2Kg: 0,
      waterL: 0,
      doseMSv: 0,
      minTempC: 0,
      maxTau: 0,
      arriveUtcMs: departUtcMs,
      minO2Frac: v.crew > 0 ? 1 : null,
      minBatteryFrac: v.kind === 'walk' ? null : 1,
    },
    samples: [],
    warnings: [],
    feasible: true,
    limitHit: null,
    pointOfNoReturnIndex: null,
    o2OutIndex: null,
    walkbackIndex: null,
    nightStops: [],
  };
}

/** What the crew and the machine are doing over a stretch of time. */
interface Activity {
  /** Work rate of each crew member, W. */
  metW: number;
  /** The crew breathe suit air (and spend scrubber time). */
  suited: boolean;
  /** Power to the wheels or rotors, W. */
  driveW: number;
  hotelW: number;
  /** Fraction of the outside dose the crew receive. */
  shield: number;
  lat: number;
  lon: number;
  elev: number;
  /** Distance along the path at the start of the stretch, and speed along it, for placing events. */
  d0: number;
  speed: number;
  /** Sample index an event in this stretch is reported at. */
  index: number;
  /** Count time in the dark as night driving. */
  moving: boolean;
}

interface TripEvent {
  index: number;
  distM: number;
  elapsedS?: number;
}

/**
 * Costs a path for a vehicle leaving at a given time: one sample per path point, totals, warnings in plain
 * words, and the points where the crew could no longer get home.
 */
export function computeTrip(path: PathPoint[], opts: TripOptions): TripResult {
  const v: Vehicle = VEHICLES[opts.vehicle] ?? VEHICLES.foot;
  const depart = finite(opts.departUtcMs);
  const scenario = opts.scenario;
  const n = path.length;
  if (n === 0) return emptyResult(depart, v);

  /* ---------- the ground ---------- */

  const lons = new Float64Array(n);
  const lats = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = path[i];
    lons[i] = finite(p?.[0] ?? Number.NaN, i > 0 ? (lons[i - 1] ?? 0) : 0);
    lats[i] = finite(p?.[1] ?? Number.NaN, i > 0 ? (lats[i - 1] ?? 0) : 0);
  }
  const elevs = cleanHeights(path);
  const along = new Float64Array(n);
  let climbM = 0;
  let descentM = 0;
  for (let i = 1; i < n; i += 1) {
    along[i] = (along[i - 1] ?? 0) + finite(distanceM(lons[i - 1] ?? 0, lats[i - 1] ?? 0, lons[i] ?? 0, lats[i] ?? 0));
    const dz = (elevs[i] ?? 0) - (elevs[i - 1] ?? 0);
    if (dz > 0) climbM += dz;
    else descentM -= dz;
  }
  const totalM = along[n - 1] ?? 0;

  /** Height a distance along the path, between its points. */
  const elevAt = (d: number): number => {
    if (d <= 0) return elevs[0] ?? 0;
    if (d >= totalM) return elevs[n - 1] ?? 0;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((along[mid] ?? 0) <= d) lo = mid;
      else hi = mid;
    }
    const a = along[lo] ?? 0;
    const span = (along[hi] ?? 0) - a;
    const za = elevs[lo] ?? 0;
    return span > 0 ? za + (((elevs[hi] ?? 0) - za) * (d - a)) / span : za;
  };

  // Signed grade of each segment (index = its end point), over a window of at least GRADE_BASE_M centred on it.
  const grade = new Float64Array(n);
  let maxGradeDeg = 0;
  for (let i = 1; i < n; i += 1) {
    let lo = along[i - 1] ?? 0;
    let hi = along[i] ?? 0;
    if (hi - lo < GRADE_BASE_M) {
      const want = Math.min(GRADE_BASE_M, totalM);
      const mid = (lo + hi) / 2;
      lo = mid - want / 2;
      hi = mid + want / 2;
      if (lo < 0) {
        hi -= lo;
        lo = 0;
      }
      if (hi > totalM) {
        lo = Math.max(0, lo - (hi - totalM));
        hi = totalM;
      }
    }
    const run = hi - lo;
    const g = run > 0.5 ? Math.atan((elevAt(hi) - elevAt(lo)) / run) * DEG : 0;
    grade[i] = finite(g);
    maxGradeDeg = Math.max(maxGradeDeg, Math.abs(grade[i] ?? 0));
  }
  if (n > 1) grade[0] = grade[1] ?? 0;

  // Work at each point; stop indices outside the path go to its nearest end.
  const workAt = new Float64Array(n);
  for (const s of opts.stops ?? []) {
    const minutes = finite(s.workMin);
    if (minutes <= 0) continue;
    const idx = Math.min(n - 1, Math.max(0, Math.round(finite(s.index))));
    workAt[idx] = (workAt[idx] ?? 0) + minutes * 60;
  }

  /* ---------- the vehicle ---------- */

  const crew = Math.max(0, v.crew);
  const hasBattery = v.kind !== 'walk' && v.batteryKWh > 0;
  const capacityKWh = hasBattery ? v.batteryKWh + v.extenderKWh : 0;
  const o2Carried = crew * v.o2KgPerPerson;
  const eco = opts.style === 'eco';
  const hotelW = eco ? v.ecoHotelW : v.hotelW;
  // A robot parked for the night sleeps on its heaters; a crewed vehicle keeps life support running.
  const parkedHotelW = crew > 0 ? hotelW : v.ecoHotelW;
  const suitedRiding = crew > 0 && !v.cabin;
  const camps = v.canCamp && opts.campAtNight === true;
  const stopsAtNight = v.needsDaylight || camps;
  const nightState: TripState = camps && !v.needsDaylight ? 'camp' : 'wait';
  const rtgW = RTG_W[v.id] ?? 0;
  const capMs = MAX_TRIP_SOLS * SOL_MS;

  /* ---------- the running books ---------- */

  let t = depart;
  // A trip that starts part way through a mission starts with what is left, not full tanks.
  const startO2 = opts.startO2Kg;
  let o2Used = startO2 !== undefined && Number.isFinite(startO2) ? Math.min(o2Carried, Math.max(0, o2Carried - startO2)) : 0;
  let energyKWh = 0;
  let solarKWh = 0;
  const startBattery = opts.startBatteryKWh;
  let battery = startBattery !== undefined && Number.isFinite(startBattery) ? Math.min(capacityKWh, Math.max(0, startBattery)) : capacityKWh;
  let minBattery = battery;
  let waterL = 0;
  let doseMSv = 0;
  let movingS = 0;
  let workS = 0;
  let waitS = 0;
  let darkMoveS = 0;
  let suitS = 0;
  let capped = false;
  let minTempC = Number.POSITIVE_INFINITY;
  let o2Out: TripEvent | null = null;
  let batteryOut: TripEvent | null = null;
  let scrubberOut: TripEvent | null = null;
  const scrubberLimitS = v.scrubberH * 3600;
  const nightStops: NightStop[] = [];

  /** Runs the clock forward through one activity, in steps short enough to follow the sun. */
  const spend = (durationS: number, a: Activity): void => {
    let left = finite(durationS);
    let done = 0;
    while (left > 0) {
      const dt = Math.min(STEP_S, left);
      const mid = t + dt * 500;
      const needSun = v.solarKW > 0 || (a.moving && crew > 0);
      const sunEl = needSun ? sunPosition(mid, a.lat, a.lon).elevDeg : 0;
      if (a.moving && crew > 0 && sunEl < 0) darkMoveS += dt;
      const placeAt = (frac: number): number => a.d0 + a.speed * (done + frac * dt);

      if (hasBattery) {
        let solar = 0;
        if (v.solarKW > 0 && sunEl > 0) {
          const tau = tauAt(a.lat, a.lon, mid, scenario);
          solar = v.solarKW * Math.sin(sunEl * RAD) * Math.exp(-PANEL_DUST_LOSS * Math.max(0, tau - TAU_CLEAR));
          solar *= dt / 3600;
        }
        const rtg = (rtgW * dt) / 3.6e6;
        const use = ((a.driveW + a.hotelW) * dt) / 3.6e6;
        const before = battery;
        battery += solar + rtg - use;
        // Charge that finds the battery full is lost; the generator's share goes first, then the panels'.
        const waste = Math.max(0, battery - capacityKWh);
        battery = Math.min(battery, capacityKWh);
        solarKWh += Math.max(0, solar - Math.max(0, waste - rtg));
        energyKWh += use;
        if (battery <= 0 && before > 0 && !batteryOut) {
          batteryOut = { index: a.index, distM: placeAt(before / Math.max(before - battery, 1e-12)) };
        }
        battery = Math.max(0, battery);
        minBattery = Math.min(minBattery, battery);
      }

      if (crew > 0) {
        const use = (crew * o2KgPerHour(a.metW) * dt) / 3600;
        const before = o2Carried - o2Used;
        o2Used += use;
        if (before > 0 && o2Carried - o2Used <= 0 && !o2Out) {
          o2Out = { index: a.index, distM: placeAt(before / Math.max(use, 1e-12)) };
        }
        const cooling = a.suited ? (SUIT_COOLING_L_PER_H_AT_250W * a.metW) / 250 : 0;
        waterL += (crew * (DRINK_L_PER_H + cooling) * dt) / 3600;
        if (a.suited && suitedRiding) {
          const beforeS = suitS;
          suitS += dt;
          if (scrubberLimitS > 0 && beforeS < scrubberLimitS && suitS >= scrubberLimitS && !scrubberOut) {
            scrubberOut = { index: a.index, distM: placeAt((scrubberLimitS - beforeS) / dt), elapsedS: suitS };
          }
        }
      }

      doseMSv += (finite(doseMSvPerSol(a.elev, mid, scenario, a.shield)) * dt) / SOL_S;
      t += dt * 1000;
      done += dt;
      left -= dt;
    }
  };

  const parkedAt = (k: number, d: number): Activity => ({
    metW: v.kind === 'walk' ? STANDING_W : SEATED_W,
    suited: suitedRiding,
    driveW: 0,
    hotelW: parkedHotelW,
    shield: v.doseFactor,
    lat: lats[k] ?? 0,
    lon: lons[k] ?? 0,
    elev: elevs[k] ?? 0,
    d0: d,
    speed: 0,
    index: k,
    moving: false,
  });

  /** Parks until sunrise. Returns false if the cap on simulated time has been reached instead. */
  const waitForSun = (k: number, lat: number, lon: number, d: number, reportIndex: number): boolean => {
    if (capped) return false;
    const day = daylight(t, lat, lon);
    if (day.light) return false;
    const from = t;
    const until = Math.min(day.untilMs, depart + capMs);
    const s = Math.max(0, (until - t) / 1000) + 1;
    spend(s, { ...parkedAt(k, d), index: reportIndex });
    waitS += s;
    minTempC = Math.min(minTempC, temperatureC(lat, lon, elevs[k] ?? 0, t, scenario));
    nightStops.push({ index: reportIndex, fromUtcMs: from, toUtcMs: t });
    if (t - depart >= capMs) capped = true;
    return true;
  };

  /* ---------- the walk or drive ---------- */

  const samples: TripSample[] = [];
  const suitAt = new Float64Array(n);
  const o2PerPersonAt = new Float64Array(n);
  let blockedFirst = -1;
  let blockedMax = 0;

  for (let i = 0; i < n; i += 1) {
    const lat = lats[i] ?? 0;
    const lon = lons[i] ?? 0;
    const elev = elevs[i] ?? 0;
    const d = along[i] ?? 0;
    let state: TripState = 'move';
    let speed = 0;

    if (i > 0) {
      // Move along the segment from point i - 1, stopping for the night where the vehicle must.
      const g = grade[i] ?? 0;
      const len = d - (along[i - 1] ?? 0);
      let sp = speedMs(v, g);
      const blocked = v.kind !== 'air' && Math.abs(g) >= v.blockSlopeDeg;
      if (blocked) {
        // Too steep: costed at a crawl so the route can still be drawn and timed, and flagged.
        sp = CRAWL_FRACTION * v.flatSpeedMs;
        if (blockedFirst < 0) blockedFirst = i;
        blockedMax = Math.max(blockedMax, Math.abs(g));
      }
      if (eco && hasBattery && v.kind === 'ground') sp *= ECO_SPEED_FACTOR;
      if (!(sp > 0)) sp = Math.max(CRAWL_FRACTION * v.flatSpeedMs, 1e-3);
      speed = sp;

      let driveW = 0;
      if (v.kind === 'air') driveW = FLIGHT_W;
      else if (v.kind === 'ground') {
        const th = g * RAD;
        // No regeneration downhill: braking energy is not stored (assumption).
        driveW = Math.max(0, (v.massKg * MARS_G * (ROLLING_RESISTANCE * Math.cos(th) + Math.sin(th)) * sp) / DRIVE_EFFICIENCY);
      }
      const prevLat = lats[i - 1] ?? lat;
      const prevLon = lons[i - 1] ?? lon;
      const moveBase: Activity = {
        metW: v.kind === 'walk' ? walkingW(sp * 3.6, g) : SEATED_W,
        suited: suitedRiding,
        driveW,
        hotelW,
        shield: v.doseFactor,
        lat: prevLat,
        lon: prevLon,
        elev: elevs[i - 1] ?? elev,
        d0: 0,
        speed: sp,
        index: i,
        moving: true,
      };

      let rem = len;
      let guard = 0;
      while (rem > 1e-9) {
        guard += 1;
        if (guard > 10_000) {
          capped = true;
        }
        let maxS = rem / sp;
        if (stopsAtNight && !capped) {
          const day = daylight(t, prevLat, prevLon);
          if (!day.light) {
            waitForSun(i - 1, prevLat, prevLon, d - rem, i);
            state = nightState;
            continue;
          }
          maxS = Math.min(maxS, Math.max(0, (day.untilMs - t) / 1000));
        }
        if (!capped && t - depart >= capMs) {
          capped = true;
          continue;
        }
        spend(maxS, { ...moveBase, d0: d - rem });
        movingS += maxS;
        rem -= maxS * sp;
        if (maxS <= 0 && !stopsAtNight) break;
      }
    }

    // Work at the point.
    const work = workAt[i] ?? 0;
    if (work > 0) {
      spend(work, {
        metW: WORK_W,
        suited: crew > 0,
        driveW: 0,
        hotelW,
        // The crew are out of the vehicle, so its walls do not shield them.
        shield: crew > 0 ? 1 : v.doseFactor,
        lat,
        lon,
        elev,
        d0: d,
        speed: 0,
        index: i,
        moving: false,
      });
      workS += work;
      if (state === 'move') state = 'work';
    }

    // Before setting off from here, wait out the night if the vehicle must.
    if (i < n - 1 && stopsAtNight && waitForSun(i, lat, lon, d, i)) state = nightState;

    suitAt[i] = suitS;
    o2PerPersonAt[i] = crew > 0 ? o2Used / crew : 0;
    const sun = sunPosition(t, lat, lon);
    const tempC = temperatureC(lat, lon, elev, t, scenario);
    minTempC = Math.min(minTempC, tempC);
    samples.push({
      distM: d,
      tS: (t - depart) / 1000,
      utcMs: t,
      elev,
      gradeDeg: grade[i] ?? 0,
      speedMs: speed,
      state,
      o2Kg: crew > 0 ? Math.max(0, o2Carried - o2Used) : null,
      batteryKWh: v.kind === 'walk' ? null : battery,
      waterL: crew > 0 ? waterL : null,
      doseMSv,
      tempC,
      tau: tauAt(lat, lon, t, scenario),
      sunElevDeg: sun.elevDeg,
    });
  }

  /* ---------- getting home ---------- */

  // Walking home from each point over the same ground the other way, or (on a loop) onward to the end.
  const backS = new Float64Array(n);
  const backO2 = new Float64Array(n);
  const onS = new Float64Array(n);
  const onO2 = new Float64Array(n);
  const legWalk = (len: number, g: number): [number, number] => {
    let sp = speedMs(SUIT, g);
    if (!(sp > 0)) sp = CRAWL_FRACTION * SUIT.flatSpeedMs;
    const s = len / sp;
    return [s, (o2KgPerHour(walkingW(sp * 3.6, g)) * s) / 3600];
  };
  for (let i = 1; i < n; i += 1) {
    const [s, o2] = legWalk((along[i] ?? 0) - (along[i - 1] ?? 0), -(grade[i] ?? 0));
    backS[i] = (backS[i - 1] ?? 0) + s;
    backO2[i] = (backO2[i - 1] ?? 0) + o2;
  }
  for (let i = n - 2; i >= 0; i -= 1) {
    const [s, o2] = legWalk((along[i + 1] ?? 0) - (along[i] ?? 0), grade[i + 1] ?? 0);
    onS[i] = (onS[i + 1] ?? 0) + s;
    onO2[i] = (onO2[i + 1] ?? 0) + o2;
  }
  const loop =
    n > 2 && distanceM(lons[0] ?? 0, lats[0] ?? 0, lons[n - 1] ?? 0, lats[n - 1] ?? 0) <= LOOP_CLOSE_M && totalM > LOOP_CLOSE_M;
  const limitS = (1 - RESERVE) * SUIT.scrubberH * 3600;
  const limitO2 = (1 - RESERVE) * SUIT.o2KgPerPerson;

  /** The last point from which the walk home fits, if some later point is past it. */
  const lastHomeable = (usedS: (k: number) => number, usedO2: (k: number) => number): number | null => {
    const fits = (s: number, o2: number) => s <= limitS + 1e-6 && o2 <= limitO2 + 1e-9;
    for (let k = 0; k < n; k += 1) {
      const s0 = usedS(k);
      const o0 = usedO2(k);
      const ok = fits(s0 + (backS[k] ?? 0), o0 + (backO2[k] ?? 0)) || (loop && fits(s0 + (onS[k] ?? 0), o0 + (onO2[k] ?? 0)));
      if (!ok) return Math.max(0, k - 1);
    }
    return null;
  };

  let pointOfNoReturnIndex: number | null = null;
  let walkbackIndex: number | null = null;
  if (crew > 0 && n > 1) {
    const usedS = (k: number) => (suitedRiding ? (suitAt[k] ?? 0) : 0);
    const usedO2 = (k: number) => (suitedRiding ? (o2PerPersonAt[k] ?? 0) : 0);
    if (v.kind === 'walk') pointOfNoReturnIndex = lastHomeable(usedS, usedO2);
    else if (v.kind === 'ground') walkbackIndex = lastHomeable(usedS, usedO2);
  }

  /* ---------- verdict ---------- */

  const durationS = movingS + workS + waitS;
  const arriveUtcMs = depart + durationS * 1000;
  const last = samples[samples.length - 1];
  const limits = new Set<TripLimit>();
  const warnings: TripWarning[] = [];
  const warn = (w: TripWarning) => warnings.push(w);

  const firstO2Out = o2Out as TripEvent | null;
  let o2OutIndex: number | null = null;
  if (firstO2Out) {
    o2OutIndex = firstO2Out.index;
    limits.add('o2');
    warn({ severity: 'warning', code: 'o2-out', text: `Oxygen runs out ${km(firstO2Out.distM)} km in.`, index: o2OutIndex });
  }
  const firstBatteryOut = batteryOut as TripEvent | null;
  if (firstBatteryOut) {
    limits.add('battery');
    warn({
      severity: 'warning',
      code: 'battery-out',
      text: `Battery runs out ${km(firstBatteryOut.distM)} km in.`,
      index: firstBatteryOut.index,
    });
  }
  const firstScrubberOut = scrubberOut as TripEvent | null;
  if (firstScrubberOut) {
    limits.add('scrubber');
    warn({
      severity: 'warning',
      code: 'scrubber-out',
      text: `The CO2 scrubbers run out ${km(firstScrubberOut.distM)} km in, after ${v.scrubberH} hours in suits.`,
      index: firstScrubberOut.index,
    });
  }
  if (blockedFirst > 0) {
    limits.add('slope');
    warn({
      severity: 'warning',
      code: 'slope-blocked',
      text: `The ground ${km(along[blockedFirst - 1] ?? 0)} km in is too steep to ${v.kind === 'walk' ? 'walk' : 'drive'}: ${blockedMax.toFixed(0)}° against a limit of ${v.blockSlopeDeg}°.`,
      index: blockedFirst,
    });
  }
  const nightS = nightStops.reduce((sum, s) => sum + (s.toUtcMs - s.fromUtcMs) / 1000, 0);
  const firstNight = nightStops[0];
  if (firstNight) {
    const plural = nightStops.length === 1 ? 'night' : 'nights';
    if (suitedRiding) {
      limits.add('daylight');
      warn({
        severity: 'warning',
        code: 'night-in-suits',
        text: `Night falls ${km(along[firstNight.index] ?? 0)} km in, and a suited crew cannot wait ${hours((firstNight.toUtcMs - firstNight.fromUtcMs) / 1000)} hours outside for sunrise.`,
        index: firstNight.index,
      });
    } else if (nightState === 'camp') {
      warn({
        severity: 'note',
        code: 'camp',
        text: `Camps for ${nightStops.length} ${plural}, ${hours(nightS)} hours in all, and drives on after sunrise.`,
        index: firstNight.index,
      });
    } else {
      warn({
        severity: 'note',
        code: 'night-wait',
        text: `Parks for ${nightStops.length} ${plural}, ${hours(nightS)} hours in all, waiting for sunrise.`,
        index: firstNight.index,
      });
    }
  }
  if (darkMoveS >= 60) {
    warn({
      severity: 'advisory',
      code: 'night-drive',
      text: `${v.kind === 'walk' ? 'Walks' : 'Drives'} ${hours(darkMoveS)} hours in the dark.`,
    });
  }
  if (last && n > 1 && crew > 0 && last.sunElevDeg < 0) {
    warn({
      severity: 'caution',
      code: 'ends-after-dark',
      text: `Arrives after dark, at ${clock(marsTime(last.utcMs, lons[n - 1] ?? 0).ltstH)} local solar time.`,
      index: n - 1,
    });
  }
  if (pointOfNoReturnIndex !== null) {
    warn({
      severity: 'caution',
      code: 'no-return',
      text: `Point of no return at ${km(along[pointOfNoReturnIndex] ?? 0)} km: past it the walk back would leave less than a 20% reserve of oxygen or scrubber time.`,
      index: pointOfNoReturnIndex,
    });
  }
  if (walkbackIndex !== null) {
    warn({
      severity: suitedRiding ? 'warning' : 'advisory',
      code: 'walkback',
      text: `Past ${km(along[walkbackIndex] ?? 0)} km the crew could not walk home on suit air if the rover broke down.`,
      index: walkbackIndex,
    });
  }
  if (capped) {
    limits.add('daylight');
    warn({
      severity: 'warning',
      code: 'too-long',
      text: `The trip runs past ${MAX_TRIP_SOLS} sols, so daylight is not checked after that.`,
    });
  }

  const limitHit = LIMIT_ORDER.find((l) => limits.has(l)) ?? null;
  let maxTau = 0;
  for (const s of samples) maxTau = Math.max(maxTau, s.tau);

  return {
    totals: {
      distM: totalM,
      durationS,
      movingS,
      workS,
      waitS,
      climbM,
      descentM,
      maxGradeDeg,
      energyKWh,
      solarKWh,
      o2Kg: o2Used,
      waterL,
      doseMSv,
      minTempC: Number.isFinite(minTempC) ? minTempC : 0,
      maxTau,
      arriveUtcMs,
      minO2Frac: crew > 0 && o2Carried > 0 ? Math.max(0, o2Carried - o2Used) / o2Carried : null,
      minBatteryFrac: hasBattery ? minBattery / capacityKWh : v.kind === 'walk' ? null : 1,
    },
    samples,
    warnings,
    feasible: limitHit === null,
    limitHit,
    pointOfNoReturnIndex,
    o2OutIndex,
    walkbackIndex,
    nightStops,
  };
}
