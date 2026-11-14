import { describe, expect, it } from 'vitest';
import { explainRoute } from './explain';
import type { GeologyData } from './geology';
import { haversineM, pathLengthM } from './terrain';
import type { PathPoint, TripResult, TripSample, Vehicle } from './types';

const M_PER_DEG = (Math.PI / 180) * 3_396_190;

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'foot',
    name: 'On foot',
    blurb: 'Two crew in suits.',
    kind: 'walk',
    crew: 2,
    flatSpeedMs: 3.3 / 3.6,
    comfortSlopeDeg: 15,
    blockSlopeDeg: 25,
    batteryKWh: 0,
    extenderKWh: 0,
    solarKW: 0,
    hotelW: 0,
    ecoHotelW: 0,
    massKg: 240,
    o2KgPerPerson: 0.9,
    scrubberH: 8,
    cabin: false,
    doseFactor: 1,
    needsDaylight: true,
    canCamp: false,
    eyeHeightM: 1.7,
    footprintM: [1, 1],
    ...over,
  };
}

/** West to east along 18.2 N from 77.05 E, bowed north by bowM in the middle. */
function path(lengthM: number, bowM = 0, points = 81): PathPoint[] {
  const out: PathPoint[] = [];
  const perLon = M_PER_DEG * Math.cos((18.2 * Math.PI) / 180);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    out.push([77.05 + (t * lengthM) / perLon, 18.2 + (bowM * Math.sin(Math.PI * t)) / M_PER_DEG, -2500 + 40 * t]);
  }
  return out;
}

function sample(distM: number, sunElevDeg: number): TripSample {
  return {
    distM,
    tS: distM,
    utcMs: distM * 1000,
    elev: -2500,
    gradeDeg: 0,
    speedMs: 0.9,
    state: 'move',
    o2Kg: 1.5,
    batteryKWh: null,
    waterL: 0.2,
    doseMSv: 0.01,
    tempC: -40,
    tau: 0.4,
    sunElevDeg,
  };
}

function trip(p: PathPoint[], over: Partial<TripResult> = {}, totals: Partial<TripResult['totals']> = {}, sunAtEnd = 34): TripResult {
  const distM = pathLengthM(p);
  let d = 0;
  const samples = p.map((pt, i) => {
    const prev = p[i - 1];
    if (prev) d += haversineM(prev, pt);
    return sample(d, i === p.length - 1 ? sunAtEnd : 50);
  });
  return {
    totals: {
      distM,
      durationS: 3 * 3600 + 20 * 60,
      movingS: 3 * 3600 + 20 * 60,
      workS: 0,
      waitS: 0,
      climbM: 318.4,
      descentM: 110.2,
      maxGradeDeg: 13.6,
      energyKWh: 0,
      solarKWh: 0,
      o2Kg: 0.5,
      waterL: 1,
      doseMSv: 0.1,
      minTempC: -60,
      maxTau: 0.4,
      arriveUtcMs: 0,
      minO2Frac: 0.7,
      minBatteryFrac: null,
      ...totals,
    },
    samples,
    warnings: [],
    feasible: true,
    limitHit: null,
    pointOfNoReturnIndex: null,
    o2OutIndex: null,
    walkbackIndex: null,
    nightStops: [],
    ...over,
  };
}

function square(w: number, s: number, e: number, n: number): number[][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/** HNt west of 77.15 E, mNh east of it. */
const geo: GeologyData = {
  units: [
    { code: 'HNt', name: 'Hesperian and Noachian transition unit', colour: '#b98', kind: 'transition', what: '', period: 'Hesperian and Noachian', age: '' },
    { code: 'mNh', name: 'Middle Noachian highland unit', colour: '#a76', kind: 'highland', what: '', period: 'Middle Noachian', age: '' },
  ],
  features: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { unit: 'HNt' }, geometry: { type: 'Polygon', coordinates: [square(77, 18, 77.15, 18.4)] } },
      { type: 'Feature', properties: { unit: 'mNh' }, geometry: { type: 'Polygon', coordinates: [square(77.15, 18, 77.6, 18.4)] } },
    ],
  },
};

function plain(lines: string[]): void {
  for (const line of lines) {
    expect(line.length).toBeGreaterThan(20);
    expect(line.length).toBeLessThan(220);
    expect(line).toMatch(/^[A-Z].*\.$/);
    // Letters, digits and plain punctuation only: no emoji, no symbols.
    expect(line).toMatch(/^[A-Za-z0-9 .,:;%()'-]+$/);
    expect(line).not.toMatch(/NaN|undefined|Infinity|null/);
  }
}

describe('explainRoute', () => {
  it('gives five lines with a geologic map: shape, end of day, rock, parked time, climb', () => {
    const p = path(12_000, 1500);
    const lines = explainRoute({ path: p, trip: trip(p), vehicle: vehicle(), geo, straightLineM: 12_000 });
    expect(lines.length).toBe(5);
    plain(lines);
    const km = (pathLengthM(p) / 1000).toFixed(1);
    const pct = Math.round((pathLengthM(p) / 12_000 - 1) * 100);
    expect(lines[0]).toBe(
      `The route is ${km} km, ${pct}% longer than the 12.0 km straight line. It swings up to 1.5 km north of that line to keep to ground the crew can take.`,
    );
    expect(lines[1]).toBe('The trip takes 3 h 20 min and ends in daylight, with the Sun 34 degrees above the horizon.');
    expect(lines[2]).toMatch(
      /^It crosses 2 rock units: Hesperian and Noachian transition unit \(HNt\), then Middle Noachian highland unit \(mNh\)\. Older rock, mNh at about 3\.9 billion years, starts (\d\.\d) km in\.$/,
    );
    const where = Number(/starts (\d\.\d) km in/.exec(lines[2] ?? '')?.[1]);
    // 77.15 E is 0.1 degrees east of the start: about 5.6 km in a straight line, a little more along the bow.
    expect(where).toBeGreaterThan(5.6);
    expect(where).toBeLessThan(6.2);
    expect(lines[3]).toBe('No time is spent parked: the whole trip is on the move.');
    expect(lines[4]).toBe('The route climbs 318 m and drops 110 m. Its steepest stretch is 14 degrees; the crew can take 25.');
  });

  it('gives four lines without a geologic map, or where the map has nothing', () => {
    const p = path(12_000);
    const t = trip(p);
    expect(explainRoute({ path: p, trip: t, vehicle: vehicle(), straightLineM: 12_000 }).length).toBe(4);
    const empty: GeologyData = { units: [], features: { type: 'FeatureCollection', features: [] } };
    const lines = explainRoute({ path: p, trip: t, vehicle: vehicle(), geo: empty, straightLineM: 12_000 });
    expect(lines.length).toBe(4);
    plain(lines);
    expect(lines[0]).toBe('The route is 12.0 km, almost a straight line.');
  });

  it('says so when the route stays on one unit, and when the oldest rock is at the start', () => {
    const short = path(4000);
    const one = explainRoute({ path: short, trip: trip(short), vehicle: vehicle(), geo, straightLineM: 4000 });
    expect(one[2]).toBe(
      'The whole way is on one rock unit: Hesperian and Noachian transition unit (HNt), about 3.7 billion years old.',
    );
    const back = path(12_000).reverse();
    const lines = explainRoute({ path: back, trip: trip(back), vehicle: vehicle(), geo, straightLineM: 12_000 });
    expect(lines[2]).toMatch(/^It crosses 2 rock units: Middle Noachian highland unit \(mNh\), then .*\(HNt\)\. The oldest rock on the way, about 3\.9 billion years old, is at the start\.$/);
    plain(lines);
  });

  it('describes how the day ends by the Sun at arrival', () => {
    const p = path(8000);
    const dusk = explainRoute({ path: p, trip: trip(p, {}, {}, 6.4), vehicle: vehicle(), straightLineM: 8000 });
    expect(dusk[1]).toBe('The trip takes 3 h 20 min and ends close to sunset, with the Sun only 6 degrees up.');
    const dark = explainRoute({ path: p, trip: trip(p, {}, { durationS: 45 * 60 }, -12.3), vehicle: vehicle(), straightLineM: 8000 });
    expect(dark[1]).toBe('The trip takes 45 min and ends after dark, with the Sun 12 degrees below the horizon.');
    const bare = explainRoute({ path: p, trip: trip(p, { samples: [] }, { durationS: 7200 }), vehicle: vehicle(), straightLineM: 8000 });
    expect(bare[1]).toBe('The trip takes 2 h.');
  });

  it('breaks parked time into work, camping and waiting', () => {
    const p = path(30_000);
    const rover = vehicle({ id: 'pressRover', name: 'Pressurised rover', kind: 'ground', blockSlopeDeg: 30, canCamp: true });
    const t = trip(
      p,
      { nightStops: [{ index: 40, fromUtcMs: 0, toUtcMs: 13 * 3600 * 1000 }] },
      { durationS: 20 * 3600, movingS: 5 * 3600, workS: 90 * 60, waitS: 13.5 * 3600 },
    );
    const lines = explainRoute({
      path: p,
      trip: t,
      vehicle: rover,
      straightLineM: 30_000,
      stops: [{ index: 0 }, { name: 'Rochette', index: 30 }, { name: 'Wildcat Ridge', index: 80 }],
    });
    expect(lines[2]).toBe(
      'Parked time is 15 h: 1 h 30 min of work at Rochette and Wildcat Ridge, 13 h camped over 1 night and 30 min waiting for daylight.',
    );
    plain(lines);
    // A stop in the middle: the straight line is the one through the stops, and no bend is described.
    const bowed = path(30_000, 4000);
    const withStop = explainRoute({
      path: bowed,
      trip: trip(bowed),
      vehicle: rover,
      straightLineM: 30_000,
      stops: [{ index: 0 }, { index: 40 }, { index: 80 }],
    });
    expect(withStop[0]).toMatch(/^The route is 3\d\.\d km, \d+% longer than the 30\.0 km straight line through its stops\.$/);

    const unnamed = explainRoute({
      path: p,
      trip: trip(p, {}, { durationS: 6 * 3600, movingS: 5 * 3600, workS: 3600 }),
      vehicle: rover,
      straightLineM: 30_000,
      stops: [{ index: 0 }, { index: 30 }, { index: 80 }],
    });
    expect(unnamed[2]).toBe('Parked time is 1 h: 1 h of work at the stops.');
  });

  it('gives the point of no return for walkers, and the walk-home limit for a crewed rover', () => {
    const p = path(12_000);
    const walk = explainRoute({ path: p, trip: trip(p, { pointOfNoReturnIndex: 30 }), vehicle: vehicle(), straightLineM: 12_000 });
    expect(walk[3]).toBe(
      'The point of no return is 4.5 km in. Past it there is not enough oxygen to walk back to the start with a reserve.',
    );
    const rover = vehicle({ id: 'openRover', name: 'Open rover', kind: 'ground' });
    const drive = explainRoute({ path: p, trip: trip(p, { walkbackIndex: 60 }), vehicle: rover, straightLineM: 12_000 });
    expect(drive[3]).toBe(
      'If the rover failed, the crew could walk home on suit air from anywhere in the first 9.0 km. Past that they could not.',
    );
    plain([...walk, ...drive]);
    // Without samples the distance comes from the path itself.
    const noSamples = explainRoute({ path: p, trip: trip(p, { pointOfNoReturnIndex: 30, samples: [] }), vehicle: vehicle(), straightLineM: 12_000 });
    expect(noSamples[3]).toMatch(/^The point of no return is 4\.5 km in\./);
  });

  it('speaks of a flight for the helicopter and copes with a missing straight line', () => {
    const p = path(900, 300);
    const heli = vehicle({ id: 'heli', name: 'Helicopter', kind: 'air', needsDaylight: true });
    const lines = explainRoute({ path: p, trip: trip(p, {}, { durationS: 150 }), vehicle: heli, straightLineM: 0 });
    expect(lines[0]).toMatch(/^The flight is 1\.\d km long\.$/);
    expect(lines[1]).toMatch(/^The trip takes 3 min/);
    expect(lines[3]).toBe('The ground under the flight rises 318 m and falls 110 m.');
    plain(lines);
    const bent = explainRoute({ path: p, trip: trip(p), vehicle: heli, straightLineM: 900 });
    expect(bent[0]).toMatch(/It swings up to 300 m north of that line\.$/);
  });
});
