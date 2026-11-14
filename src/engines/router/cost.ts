/**
 * What a route costs: builds the CostField the search runs on, for one vehicle and one style.
 *
 * The cost of a move is seconds: its length over the vehicle's speed on the slope along the way.
 * Ground steeper than the vehicle's blocking slope, and every hazard zone, is blocked. On top of
 * that each cell carries a multiplier (1 or more) that says how much a second spent there weighs:
 *
 *   1 + hug * H + rugged * R + dose * D + cold * C + dust * T + basin * B
 *
 * with every term between 0 and 1 (see the fields of StyleWeights) and the weights set per style.
 * "Fastest" is nearly bare travel time; "safest" pays to stay away from steep, rough, dusty, exposed
 * and enclosed ground; "eco" counts oxygen on foot and energy on wheels instead of time.
 * Everything here is modelled.
 */
import { MARS_G } from '../../lib/constants';
import { doseMSvPerSol, tauAt, temperatureC } from '../environment';
import { walkingW } from '../metabolic';
import { gradients } from '../terrain';
import type { Grid, HazardZone, RouteStyle, Scenario, Vehicle, VehicleId } from '../types';
import { DRIVE_EFFICIENCY, ROLLING_RESISTANCE, VEHICLES, speedMs } from '../vehicles';
import { cellSizes } from './core';
import type { CostField, CostWords, EndBlock } from './core';

export interface StyleWeights {
  /**
   * Hugging steep ground: 0 where the steepest slope on a cell and its 8 neighbours is at or below
   * the vehicle's comfortable slope, rising (squared) to 1 where it reaches the blocking slope.
   */
  hug: number;
  /** Ruggedness: mean height step to the 8 neighbours over the step the blocking slope would give. */
  rugged: number;
  /** Radiation: extra dose rate over the lowest ground on the grid; 25% more counts as 1. Crewed vehicles only. */
  dose: number;
  /** Cold: degrees below the warmest spot on the grid at departure; 20 degrees counts as 1. */
  cold: number;
  /** Dust: optical depth above the clearest sky on the grid at departure; 1 more counts as 1. */
  dust: number;
  /**
   * Crater-floor basin: how far a cell lies below the mean ground within about 1.5 km; 50 m counts
   * as 1. It marks the floors of bowls and small craters: cold air and drifted sand collect there,
   * the rim hides the radio line to base, and the only way out is up.
   */
  basin: number;
  /** Turns: each radian of heading change costs this many cells of travel at full speed. */
  turn: number;
}

/**
 * The weights for each style.
 * - safest: a second on ground at the vehicle's limit counts four times; rough, dusty, exposed and
 *   enclosed ground all cost, and turns are dear so the line is smooth.
 * - fastest: travel time with just enough weight on steep and rough ground that it does not scrape
 *   the limit to save a few seconds.
 * - eco: the base cost is oxygen (on foot) or energy (on wheels) instead of time, so the weights
 *   only cover what that leaves out: rough ground, cold (heaters), and bowls to climb out of.
 */
export const STYLE_WEIGHTS: Record<RouteStyle, StyleWeights> = {
  safest: { hug: 3, rugged: 1.5, dose: 2, cold: 0.5, dust: 1.5, basin: 1, turn: 2 },
  fastest: { hug: 0.5, rugged: 0.25, dose: 0, cold: 0, dust: 0.25, basin: 0, turn: 0.5 },
  eco: { hug: 1, rugged: 0.75, dose: 0, cold: 0.25, dust: 0.25, basin: 0.5, turn: 1 },
};

/** The steepest ground a small helicopter can take off from and land on, degrees (approximate; Ingenuity's airfields were chosen under about 10). */
export const AIR_LANDING_SLOPE_DEG = 10;
/** Radius of the neighbourhood a basin is measured against, metres. */
export const BASIN_RADIUS_M = 1500;
/** Depth below the neighbourhood mean that counts as a full basin, metres. */
export const BASIN_DEPTH_M = 50;

export interface CostOptions {
  vehicle: Vehicle | VehicleId;
  style: RouteStyle;
  departUtcMs: number;
  scenario: Scenario;
  hazards: readonly HazardZone[];
}

/** The models the cost reads. Tests pass small fakes; the defaults are the app's engines. */
export interface CostDeps {
  speedMs(vehicle: Vehicle, gradeDeg: number): number;
  walkingW(speedKmh: number, gradeDeg: number): number;
  doseMSvPerSol(elev: number, utcMs: number, scenario: Scenario, doseFactor?: number): number;
  temperatureC(lat: number, lon: number, elev: number, utcMs: number, scenario: Scenario): number;
  tauAt(lat: number, lon: number, utcMs: number, scenario: Scenario): number;
}

const DEFAULT_DEPS: CostDeps = { speedMs, walkingW, doseMSvPerSol, temperatureC, tauAt };

const DEG = Math.PI / 180;
const PACE_STEPS = 2000;
/** Blocked-cell codes: 0 open, 1 too steep, 2 + k inside hazard k. */
const STEEP = 1;
const HAZARD0 = 2;

const WORDS: Record<Vehicle['kind'], CostWords> = {
  walk: { vehicle: 'a walker', climb: 'can climb', spot: 'walkable spot' },
  ground: { vehicle: 'the rover', climb: 'can climb', spot: 'drivable spot' },
  air: { vehicle: 'the helicopter', climb: 'can land on', spot: 'landing spot' },
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface Pace {
  /** Seconds per metre by the slope along the way (see CostField.pace). */
  table: Float64Array;
  /** The least any metre costs for its time alone. */
  minSecPerM: number;
  /** For energy costs: the part that is work against rolling resistance and height (see CostField.lift). */
  lift: { perM: number; perRiseM: number } | null;
}

/**
 * Seconds per metre by the slope along the way, weighed for the style.
 * - on foot, eco: each second is weighed by walkingW / 250, so the cost is oxygen; walkers keep their pace
 * - on wheels with a battery, eco: the energy used per metre (the eco hotel load for the time taken,
 *   plus the work of rolling and climbing, which is nothing on a descent steep enough to roll) over
 *   the power drawn on the flat, so a flat metre costs its travel time
 * - otherwise: travel time
 */
function paceBySlope(vehicle: Vehicle, style: RouteStyle, tanMax: number, deps: CostDeps): Pace {
  const table = new Float64Array(PACE_STEPS + 1);
  const flat = deps.speedMs(vehicle, 0);
  const pushNPerTan = (vehicle.massKg * MARS_G) / DRIVE_EFFICIENCY;
  const flatPowerW = vehicle.ecoHotelW + pushNPerTan * ROLLING_RESISTANCE * flat;
  const energy = style === 'eco' && vehicle.kind === 'ground' && vehicle.batteryKWh > 0 && flatPowerW > 0;
  const oxygen = style === 'eco' && vehicle.kind === 'walk';
  let least = Infinity;
  for (let i = 0; i <= PACE_STEPS; i++) {
    const tan = -tanMax + (i * 2 * tanMax) / PACE_STEPS;
    const gradeDeg = Math.atan(tan) / DEG;
    const v = deps.speedMs(vehicle, gradeDeg);
    if (!(v > 0)) {
      table[i] = Infinity;
      continue;
    }
    let timePart = 1 / v;
    let workPart = 0;
    if (oxygen) {
      timePart *= deps.walkingW(v * 3.6, gradeDeg) / 250;
    } else if (energy) {
      timePart = vehicle.ecoHotelW / v / flatPowerW;
      workPart = (pushNPerTan * Math.max(0, ROLLING_RESISTANCE + tan)) / flatPowerW;
    }
    table[i] = timePart + workPart;
    if (timePart < least) least = timePart;
  }
  return {
    table,
    minSecPerM: least,
    lift: energy
      ? { perM: (pushNPerTan * ROLLING_RESISTANCE) / flatPowerW, perRiseM: pushNPerTan / flatPowerW }
      : null,
  };
}

/** A value known on a coarse lattice over the grid, read bilinearly per cell. */
function lattice(grid: Grid, value: (lat: number, lon: number) => number): (row: number, col: number) => number {
  const stride = Math.max(1, Math.ceil(Math.max(grid.rows, grid.cols) / 96));
  const nr = Math.ceil((grid.rows - 1) / stride) + 1;
  const nc = Math.ceil((grid.cols - 1) / stride) + 1;
  const nodes = new Float64Array(nr * nc);
  for (let i = 0; i < nr; i++) {
    const lat = grid.latOf(i * stride);
    for (let j = 0; j < nc; j++) nodes[i * nc + j] = value(lat, grid.lonOf(j * stride));
  }
  return (row, col) => {
    const fr = row / stride;
    const fc = col / stride;
    const i = Math.min(fr | 0, Math.max(nr - 2, 0));
    const j = Math.min(fc | 0, Math.max(nc - 2, 0));
    const i1 = Math.min(i + 1, nr - 1);
    const j1 = Math.min(j + 1, nc - 1);
    const tr = fr - i;
    const tc = fc - j;
    const top = (nodes[i * nc + j] as number) * (1 - tc) + (nodes[i * nc + j1] as number) * tc;
    const bottom = (nodes[i1 * nc + j] as number) * (1 - tc) + (nodes[i1 * nc + j1] as number) * tc;
    return top * (1 - tr) + bottom * tr;
  };
}

/** Mean height of the square neighbourhood around every cell, by a summed-area table. */
function neighbourhoodMean(grid: Grid, radiusCells: number): Float32Array {
  const { rows, cols, heights } = grid;
  const W = cols + 1;
  const sat = new Float64Array((rows + 1) * W);
  for (let r = 0; r < rows; r++) {
    let run = 0;
    for (let c = 0; c < cols; c++) {
      run += heights[r * cols + c] as number;
      sat[(r + 1) * W + c + 1] = (sat[r * W + c + 1] as number) + run;
    }
  }
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const r0 = Math.max(0, r - radiusCells);
    const r1 = Math.min(rows, r + radiusCells + 1);
    for (let c = 0; c < cols; c++) {
      const c0 = Math.max(0, c - radiusCells);
      const c1 = Math.min(cols, c + radiusCells + 1);
      const sum =
        (sat[r1 * W + c1] as number) - (sat[r0 * W + c1] as number) - (sat[r1 * W + c0] as number) + (sat[r0 * W + c0] as number);
      out[r * cols + c] = sum / ((r1 - r0) * (c1 - c0));
    }
  }
  return out;
}

/**
 * Build the cost field for a vehicle and a style on a grid.
 *
 * Blocked: cells steeper (Horn) than the vehicle's blocking slope, and cells whose centre is inside
 * a hazard zone. The helicopter is blocked only by hazard zones in flight; it needs ground no
 * steeper than AIR_LANDING_SLOPE_DEG at its two ends.
 */
export function makeCost(grid: Grid, options: CostOptions, deps: Partial<CostDeps> = {}): CostField {
  const d: CostDeps = { ...DEFAULT_DEPS, ...deps };
  const vehicle = typeof options.vehicle === 'string' ? VEHICLES[options.vehicle] : options.vehicle;
  const { style, departUtcMs, scenario, hazards } = options;
  const weights = STYLE_WEIGHTS[style];
  const { rows, cols, heights } = grid;
  const n = rows * cols;
  const air = vehicle.kind === 'air';
  const cellMByRow = cellSizes(grid);

  const { east: gradE, north: gradN } = gradients(grid);
  const slopeDegAt = (cell: number): number =>
    Math.atan(Math.hypot(gradE[cell] as number, gradN[cell] as number)) / DEG;

  /* Blocked cells. */
  const blocked = new Uint8Array(n);
  const blockTan = Math.tan(Math.min(vehicle.blockSlopeDeg, 89.9) * DEG);
  if (!air) {
    for (let i = 0; i < n; i++) {
      if (Math.hypot(gradE[i] as number, gradN[i] as number) > blockTan) blocked[i] = STEEP;
    }
  }
  hazards.forEach((zone, k) => {
    const r0 = grid.rowOf(zone.lat);
    const c0 = grid.colOf(zone.lon);
    if (!(zone.radiusM > 0) || !Number.isFinite(r0) || !Number.isFinite(c0)) return;
    const rowAt = Math.min(rows - 1, Math.max(0, Math.round(r0)));
    // Half a cell's diagonal more than the radius: any cell that reaches into the zone is blocked,
    // so no point of a route, wherever it lies in its cell, is inside the zone.
    const reach = zone.radiusM / (cellMByRow[rowAt] as number) + Math.SQRT1_2;
    if (!Number.isFinite(reach)) return;
    const code = Math.min(255, HAZARD0 + k);
    for (let r = Math.max(0, Math.ceil(r0 - reach)); r <= Math.min(rows - 1, Math.floor(r0 + reach)); r++) {
      for (let c = Math.max(0, Math.ceil(c0 - reach)); c <= Math.min(cols - 1, Math.floor(c0 + reach)); c++) {
        if ((r - r0) ** 2 + (c - c0) ** 2 <= reach * reach) blocked[r * cols + c] = code;
      }
    }
  });

  /* Pace by slope. The table runs a little past the blocking slope, so both of its ends are blocked. */
  let pace: Float64Array;
  let paceTanMax = 1;
  let minPace = 1 / vehicle.flatSpeedMs;
  let liftPart: Pace['lift'] = null;
  if (air) {
    pace = new Float64Array([minPace]);
  } else {
    paceTanMax = Math.tan(Math.min(vehicle.blockSlopeDeg + 2, 89.9) * DEG);
    const bySlope = paceBySlope(vehicle, style, paceTanMax, d);
    pace = bySlope.table;
    minPace = bySlope.minSecPerM;
    liftPart = bySlope.lift;
  }
  const levelPace = pace[(pace.length - 1) >> 1] as number;

  /* What a second weighs on each cell. */
  const mult = new Float32Array(n).fill(1);

  if (!air) {
    const comfort = Math.min(vehicle.comfortSlopeDeg, vehicle.blockSlopeDeg - 0.5);
    const span = Math.max(0.5, vehicle.blockSlopeDeg - comfort);
    const slope = new Float32Array(n);
    for (let i = 0; i < n; i++) slope[i] = slopeDegAt(i);
    const basinMean =
      weights.basin > 0
        ? neighbourhoodMean(grid, Math.max(2, Math.round(BASIN_RADIUS_M / grid.cellWidthM)))
        : null;
    for (let r = 0; r < rows; r++) {
      const rugScale = 1 / ((cellMByRow[r] as number) * Math.max(blockTan, 1e-6));
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const z = heights[i] as number;
        let steepest = 0;
        let rough = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr < 0 ? 0 : r + dr >= rows ? rows - 1 : r + dr;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc < 0 ? 0 : c + dc >= cols ? cols - 1 : c + dc;
            const j = rr * cols + cc;
            const s = slope[j] as number;
            if (s > steepest) steepest = s;
            rough += Math.abs((heights[j] as number) - z);
          }
        }
        const hug = clamp01((steepest - comfort) / span) ** 2;
        const rugged = clamp01((rough / 8) * rugScale);
        let m = 1 + weights.hug * hug + weights.rugged * rugged;
        if (basinMean) m += weights.basin * clamp01(((basinMean[i] as number) - z) / BASIN_DEPTH_M);
        mult[i] = m;
      }
    }
  }

  /* Radiation: by height, read from a table over the grid's range of heights. */
  const doseWeight = vehicle.crew > 0 ? weights.dose : 0;
  if (doseWeight > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const z = heights[i] as number;
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    const steps = 64;
    const table = new Float64Array(steps + 1);
    let least = Infinity;
    for (let k = 0; k <= steps; k++) {
      table[k] = d.doseMSvPerSol(lo + ((hi - lo) * k) / steps, departUtcMs, scenario, vehicle.doseFactor);
      if ((table[k] as number) < least) least = table[k] as number;
    }
    if (hi > lo && least > 0 && Number.isFinite(least)) {
      const scale = steps / (hi - lo);
      for (let i = 0; i < n; i++) {
        const x = ((heights[i] as number) - lo) * scale;
        const k = Math.min(x | 0, steps - 1);
        const dose = (table[k] as number) + ((table[k + 1] as number) - (table[k] as number)) * (x - k);
        mult[i] = (mult[i] as number) + doseWeight * clamp01((dose / least - 1) * 4);
      }
    }
  }

  /* Cold and dust at departure, read from a coarse lattice (they change slowly over the ground). */
  if (weights.cold > 0 || weights.dust > 0) {
    const midLat = grid.latOf((rows - 1) / 2);
    const midLon = grid.lonOf((cols - 1) / 2);
    const refElev = grid.elevation(midLat, midLon);
    const lapsePerM =
      (d.temperatureC(midLat, midLon, refElev + 1000, departUtcMs, scenario) -
        d.temperatureC(midLat, midLon, refElev, departUtcMs, scenario)) /
      1000;
    const tempAt = weights.cold > 0 ? lattice(grid, (lat, lon) => d.temperatureC(lat, lon, refElev, departUtcMs, scenario)) : null;
    const tauOf = weights.dust > 0 ? lattice(grid, (lat, lon) => d.tauAt(lat, lon, departUtcMs, scenario)) : null;
    let warmest = -Infinity;
    let clearest = Infinity;
    const temp = tempAt ? new Float32Array(n) : null;
    const tau = tauOf ? new Float32Array(n) : null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (temp && tempAt) {
          const t = tempAt(r, c) + ((heights[i] as number) - refElev) * lapsePerM;
          temp[i] = t;
          if (t > warmest) warmest = t;
        }
        if (tau && tauOf) {
          const t = tauOf(r, c);
          tau[i] = t;
          if (t < clearest) clearest = t;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      let m = mult[i] as number;
      if (temp) m += weights.cold * clamp01((warmest - (temp[i] as number)) / 20);
      if (tau) m += weights.dust * clamp01((tau[i] as number) - clearest);
      mult[i] = m;
    }
  }

  let minMult = Infinity;
  for (let i = 0; i < n; i++) {
    const m = mult[i] as number;
    if (!blocked[i] && m < minMult) minMult = m;
  }
  if (!(minMult >= 1) || !Number.isFinite(minMult)) minMult = 1;

  const endBlock = (cell: number): EndBlock | null => {
    const code = blocked[cell] as number;
    if (code >= HAZARD0) {
      const zone = hazards[Math.min(code - HAZARD0, hazards.length - 1)];
      return { kind: 'hazard', hazard: zone?.kind ?? 'keepOut' };
    }
    const slopeDeg = slopeDegAt(cell);
    if (code === STEEP) return { kind: 'steep', slopeDeg };
    if (air && slopeDeg > AIR_LANDING_SLOPE_DEG) return { kind: 'steep', slopeDeg };
    return null;
  };

  return {
    rows,
    cols,
    cellMByRow,
    blocked,
    mult,
    gradE: air ? null : gradE,
    gradN: air ? null : gradN,
    pace,
    paceTanMax,
    minSecPerM: minPace * minMult,
    ...(liftPart
      ? { lift: { heights, perM: liftPart.perM * minMult, perRiseM: liftPart.perRiseM * minMult } }
      : {}),
    turnSPerRad: air ? 0 : weights.turn * grid.cellWidthM * levelPace,
    endBlock,
    words: WORDS[vehicle.kind],
  };
}
