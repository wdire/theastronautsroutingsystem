/** A small, real mission world for the net layer's tests: a 2 km walk north with one stop and one task. */
import { nextLtst } from '@/engines/marsTime';
import type { MissionPlan, PathPoint, TripResult, TripSample } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { pathStats, shapeOnlyTrip } from '@/planner/geometry';
import type { World } from '@/sim/types';
import { createWorld, startMission } from '@/sim/world';

const M_PER_DEG = (2 * Math.PI * 3_396_190) / 360;
const LON = 77.4;
const LAT0 = 18.4;
const FOOT = VEHICLES.foot.flatSpeedMs;
export const DEPART = nextLtst(Date.UTC(2026, 10, 14), LON, 8.5);

const north = (m: number): PathPoint => [LON, LAT0 + m / M_PER_DEG, -2500];

export const PATH: PathPoint[] = Array.from({ length: 21 }, (_, i) => north(i * 100));

export function trip(path: PathPoint[] = PATH, holdAt = 10, holdS = 1800): TripResult {
  const along = pathStats(path).along;
  const samples: TripSample[] = [];
  let t = 0;
  path.forEach((p, i) => {
    if (i > 0) t += ((along[i] ?? 0) - (along[i - 1] ?? 0)) / FOOT;
    if (i === holdAt) t += holdS;
    samples.push({ distM: along[i] ?? 0, tS: t, utcMs: DEPART + t * 1000, elev: p[2], gradeDeg: 0, speedMs: FOOT, state: i === holdAt ? 'work' : 'move', o2Kg: 1.8 - (0.1 * t) / 3600, batteryKWh: null, waterL: (0.2 * t) / 3600, doseMSv: (0.002 * t) / 3600, tempC: -40, tau: 0.5, sunElevDeg: 30 });
  });
  const base = shapeOnlyTrip(path);
  return { ...base, samples, totals: { ...base.totals, durationS: t, doseMSv: (0.002 * t) / 3600, o2Kg: (0.1 * t) / 3600 } };
}

export const PLAN: MissionPlan = {
  start: { lon: LON, lat: LAT0, name: 'Base camp' },
  stops: [{ id: 's1', lon: LON, lat: LAT0 + 1000 / M_PER_DEG, name: 'Delta front', tasks: [{ id: 't1', kind: 'sample', minutes: 30 }] }],
  roundTrip: false,
  vehicle: 'foot',
  style: 'safest',
  campAtNight: false,
};

export function startedWorld(): World {
  return startMission(createWorld(DEPART - 3_600_000, 7), { name: 'Delta walk', plan: PLAN, path: PATH, stopIndices: [0, 10, 20], trip: trip() }, DEPART);
}
