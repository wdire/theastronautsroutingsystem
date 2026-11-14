import { describe, expect, it } from 'vitest';
import type { PathPoint, RouteCandidate, RouteStyle, TripResult } from '../types';
import { labelFor, meanSeparationM, mergeAlternatives } from './alternatives';

const M_PER_DEG_LAT = (Math.PI / 180) * 3_396_190;

/** A west-to-east path 6 km long near Jezero, shifted north by some metres, bowed by some more. */
function path(northM = 0, bowM = 0, points = 61): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const lat = 18.4 + (northM + bowM * Math.sin(Math.PI * t)) / M_PER_DEG_LAT;
    out.push([77.4 + (t * 6000) / (M_PER_DEG_LAT * Math.cos((18.4 * Math.PI) / 180)), lat, -2500]);
  }
  return out;
}

function trip(durationS: number, energyKWh: number, o2Kg: number): TripResult {
  return {
    totals: {
      distM: 6000,
      durationS,
      movingS: durationS,
      workS: 0,
      waitS: 0,
      climbM: 0,
      descentM: 0,
      maxGradeDeg: 0,
      energyKWh,
      solarKWh: 0,
      o2Kg,
      waterL: 0,
      doseMSv: 0,
      minTempC: -60,
      maxTau: 0.4,
      arriveUtcMs: durationS * 1000,
      minO2Frac: null,
      minBatteryFrac: null,
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

function candidate(style: RouteStyle, p: PathPoint[], t: TripResult): RouteCandidate {
  return { style, path: p, stopIndices: [0, p.length - 1], trip: t };
}

describe('meanSeparationM', () => {
  it('is zero for the same path and the offset for a shifted one', () => {
    expect(meanSeparationM(path(), path())).toBeCloseTo(0, 6);
    expect(meanSeparationM(path(), path(200))).toBeCloseTo(200, 0);
    expect(meanSeparationM(path(), path(0, 300))).toBeCloseTo((300 * 2) / Math.PI, -1);
  });

  it('does not depend on how finely each path is sampled, or on the order given', () => {
    const coarse = path(100, 0, 2);
    const fine = path(0, 0, 301);
    expect(meanSeparationM(coarse, fine)).toBeCloseTo(100, 0);
    expect(meanSeparationM(fine, coarse)).toBeCloseTo(100, 0);
  });

  it('counts a path that covers only part of the other as apart', () => {
    const half = path().slice(0, 31);
    expect(meanSeparationM(half, path())).toBeGreaterThan(500);
  });
});

describe('labelFor', () => {
  it('writes the label for one, two and three styles', () => {
    expect(labelFor(['fastest'])).toBe('Fastest');
    expect(labelFor(['safest', 'fastest'])).toBe('Safest and fastest agree');
    expect(labelFor(['fastest', 'eco'])).toBe('Fastest and eco agree');
    expect(labelFor(['safest', 'fastest', 'eco'])).toBe('Safest, fastest and eco agree');
  });
});

describe('mergeAlternatives', () => {
  it('makes one card when every style found the same route', () => {
    const cards = mergeAlternatives([
      candidate('fastest', path(40), trip(7200, 10, 0.6)),
      candidate('eco', path(-30), trip(7300, 9.9, 0.61)),
      candidate('safest', path(0), trip(7350, 10.2, 0.6)),
    ]);
    expect(cards.length).toBe(1);
    const card = cards[0];
    expect(card?.styles).toEqual(['safest', 'fastest', 'eco']);
    expect(card?.label).toBe('Safest, fastest and eco agree');
    expect(card?.id).toBe('safest+fastest+eco');
    expect(card?.badges).toEqual([]);
    // The card carries the first style's route.
    expect(card?.trip.totals.durationS).toBe(7350);
    expect(card?.stopIndices).toEqual([0, 60]);
  });

  it('keeps routes apart when the paths differ, even with the same numbers', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0, 900), trip(7200, 10, 0.6)),
      candidate('fastest', path(0), trip(7200, 10, 0.6)),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Safest', 'Fastest']);
    expect(cards[0]?.badges).toEqual(['Same time as Fastest']);
    expect(cards[1]?.badges).toEqual(['Same time as Safest']);
  });

  it('keeps routes apart when the path is the same but a budget differs by more than 3%', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0), trip(7200, 10, 0.6)),
      candidate('fastest', path(20), trip(6800, 10, 0.6)),
    ]);
    expect(cards.length).toBe(2);
    expect(cards[1]?.badges).toContain('Quickest');
    const o2 = mergeAlternatives([
      candidate('safest', path(0), trip(7200, 10, 0.6)),
      candidate('fastest', path(20), trip(7200, 10, 0.65)),
    ]);
    expect(o2.length).toBe(2);
    const within = mergeAlternatives([
      candidate('safest', path(0), trip(7200, 10, 0.6)),
      candidate('fastest', path(20), trip(7000, 10.2, 0.61)),
    ]);
    expect(within.map((c) => c.label)).toEqual(['Safest and fastest agree']);
  });

  it('merges two styles and leaves the third on its own, with badges for real savings', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0, 1200), trip(9000, 13, 0.75)),
      candidate('fastest', path(0), trip(7200, 12, 0.7)),
      candidate('eco', path(0, -700), trip(8000, 10, 0.55)),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Safest', 'Fastest', 'Eco']);
    expect(cards.map((c) => c.id)).toEqual(['safest', 'fastest', 'eco']);
    expect(cards[0]?.badges).toEqual([]);
    expect(cards[1]?.badges).toEqual(['Quickest']);
    expect(cards[2]?.badges).toEqual(['Least O2', 'Least power']);

    const pair = mergeAlternatives([
      candidate('safest', path(0), trip(7200, 12, 0.7)),
      candidate('fastest', path(30), trip(7150, 12.1, 0.7)),
      candidate('eco', path(0, -700), trip(8000, 10, 0.55)),
    ]);
    expect(pair.map((c) => c.label)).toEqual(['Safest and fastest agree', 'Eco']);
    expect(pair[0]?.styles).toEqual(['safest', 'fastest']);
    expect(pair[0]?.badges).toEqual(['Quickest']);
  });

  it('folds an eco route that saves nothing into the route that beats it', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0, 1200), trip(9000, 13, 0.75)),
      candidate('fastest', path(0), trip(7200, 12, 0.7)),
      // A different path, slower, and its savings are under 3%: not worth a card.
      candidate('eco', path(0, -700), trip(7900, 11.8, 0.69)),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Safest', 'Fastest and eco agree']);
    expect(cards[1]?.styles).toEqual(['fastest', 'eco']);
    expect(cards[1]?.id).toBe('fastest+eco');
    // The card keeps the route that won.
    expect(cards[1]?.trip.totals.durationS).toBe(7200);
    expect(cards[1]?.badges).toEqual(['Quickest', 'Least O2', 'Least power']);
  });

  it('folds eco into the thriftier card when it beats neither', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0, 1200), trip(9000, 11, 0.6)),
      candidate('fastest', path(0), trip(7200, 12, 0.7)),
      candidate('eco', path(0, -700), trip(8000, 11.5, 0.62)),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Safest and eco agree', 'Fastest']);
  });

  it('keeps an eco route that saves oxygen or power, whichever the vehicle uses', () => {
    const walkers = mergeAlternatives([
      candidate('fastest', path(0), trip(7200, 0, 0.7)),
      candidate('eco', path(0, -700), trip(7900, 0, 0.6)),
    ]);
    expect(walkers.map((c) => c.label)).toEqual(['Fastest', 'Eco']);
    expect(walkers[0]?.badges).toEqual(['Quickest']);
    expect(walkers[1]?.badges).toEqual(['Least O2']);

    const robot = mergeAlternatives([
      candidate('fastest', path(0), trip(7200, 2, 0)),
      candidate('eco', path(0, -700), trip(7900, 1.6, 0)),
    ]);
    expect(robot[1]?.badges).toEqual(['Least power']);
    const robotNoSaving = mergeAlternatives([
      candidate('fastest', path(0), trip(7200, 2, 0)),
      candidate('eco', path(0, -700), trip(7900, 1.99, 0)),
    ]);
    expect(robotNoSaving.map((c) => c.label)).toEqual(['Fastest and eco agree']);
    expect(robotNoSaving[0]?.badges).toEqual([]);
  });

  it('gives no badge for a saving of 3% or less, and tags equal times', () => {
    const cards = mergeAlternatives([
      candidate('safest', path(0, 1200), trip(7300, 12, 0.72)),
      candidate('fastest', path(0), trip(7200, 12.2, 0.7)),
      candidate('eco', path(0, -700), trip(9000, 10, 0.5)),
    ]);
    expect(cards[0]?.badges).toEqual(['Same time as Fastest']);
    expect(cards[1]?.badges).toEqual(['Same time as Safest']);
    expect(cards[2]?.badges).toEqual(['Least O2', 'Least power']);
  });

  it('handles one candidate, none, and repeats', () => {
    expect(mergeAlternatives([])).toEqual([]);
    const one = mergeAlternatives([candidate('eco', path(0), trip(7200, 10, 0.6))]);
    expect(one.map((c) => [c.label, c.badges])).toEqual([['Eco', []]]);
    const twice = mergeAlternatives([
      candidate('fastest', path(0), trip(7200, 10, 0.6)),
      candidate('fastest', path(0, 900), trip(5000, 10, 0.6)),
    ]);
    expect(twice.length).toBe(1);
    expect(twice[0]?.trip.totals.durationS).toBe(7200);
  });

  it('does not change its input', () => {
    const input = [candidate('safest', path(0), trip(7200, 10, 0.6)), candidate('fastest', path(10), trip(7200, 10, 0.6))];
    const before = JSON.stringify(input);
    mergeAlternatives(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
