import { describe, expect, it } from 'vitest';
import { EPOCHS_GA, ageGa, unitAt, unitsAlong } from './geology';
import type { GeoUnit, GeologyData } from './geology';
import { haversineM } from './terrain';
import type { LonLat } from './types';

function unit(code: string, period: string, name = code): GeoUnit {
  return { code, name, colour: '#aa8866', kind: 'highland', what: `What ${code} is.`, period, age: '' };
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

/**
 * A small map around 77 E, 18 N:
 * - mNh: a 0.4 degree square with a square hole in its middle
 * - HNt: fills the west half of that hole (the east half of the hole has no unit)
 * - eHv: two separate squares to the east, as one MultiPolygon, the second with a hole of its own
 * - a square of a unit the legend does not list
 */
const geo: GeologyData = {
  units: [
    unit('mNh', 'Middle Noachian', 'Middle Noachian highland unit'),
    unit('HNt', 'Hesperian and Noachian', 'Hesperian and Noachian transition unit'),
    unit('eHv', 'Early Hesperian', 'Early Hesperian volcanic unit'),
  ],
  features: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { unit: 'mNh' },
        geometry: { type: 'Polygon', coordinates: [square(77, 18, 77.4, 18.4), square(77.1, 18.1, 77.3, 18.3)] },
      },
      {
        type: 'Feature',
        properties: { unit: 'HNt' },
        geometry: { type: 'Polygon', coordinates: [square(77.1, 18.1, 77.2, 18.3)] },
      },
      {
        type: 'Feature',
        properties: { unit: 'eHv', extra: 1 },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [square(77.5, 18, 77.6, 18.1)],
            [square(77.5, 18.2, 77.8, 18.5), square(77.6, 18.3, 77.7, 18.4)],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { unit: 'Zz' },
        geometry: { type: 'Polygon', coordinates: [square(76.5, 18, 76.6, 18.1)] },
      },
    ],
  },
};

describe('unitAt', () => {
  it('finds the unit under a point', () => {
    expect(unitAt(geo, 77.05, 18.2)?.code).toBe('mNh');
    expect(unitAt(geo, 77.35, 18.35)?.code).toBe('mNh');
    expect(unitAt(geo, 77.05, 18.2)?.name).toBe('Middle Noachian highland unit');
  });

  it('respects holes: the unit inside the hole, or none where the hole is empty', () => {
    expect(unitAt(geo, 77.15, 18.2)?.code).toBe('HNt');
    expect(unitAt(geo, 77.25, 18.2)).toBeNull();
  });

  it('handles MultiPolygons, each part with its own holes', () => {
    expect(unitAt(geo, 77.55, 18.05)?.code).toBe('eHv');
    expect(unitAt(geo, 77.55, 18.25)?.code).toBe('eHv');
    expect(unitAt(geo, 77.65, 18.35)).toBeNull();
    expect(unitAt(geo, 77.55, 18.15)).toBeNull();
  });

  it('returns null off the map', () => {
    expect(unitAt(geo, 70, 18.2)).toBeNull();
    expect(unitAt(geo, 77.2, 19)).toBeNull();
    expect(unitAt({ units: [], features: { type: 'FeatureCollection', features: [] } }, 77, 18)).toBeNull();
  });

  it('still names a unit the legend does not list', () => {
    const u = unitAt(geo, 76.55, 18.05);
    expect(u?.code).toBe('Zz');
    expect(u?.name).toBe('Zz');
  });
});

describe('unitsAlong', () => {
  it('lists the units crossed in order, with where each starts and ends', () => {
    // West to east along 18.2 N: outside, mNh, HNt (in the hole), nothing (rest of the hole), mNh, outside.
    const path: LonLat[] = [
      [76.95, 18.2],
      [77.45, 18.2],
    ];
    const out = unitsAlong(geo, path);
    expect(out.map((s) => s.unit.code)).toEqual(['mNh', 'HNt', 'mNh']);
    const at = (lon: number): number => haversineM([76.95, 18.2], [lon, 18.2]);
    const edges = [
      [at(77.0), at(77.1)],
      [at(77.1), at(77.2)],
      [at(77.3), at(77.4)],
    ];
    out.forEach((stretch, i) => {
      expect(Math.abs(stretch.fromM - (edges[i]?.[0] ?? 0))).toBeLessThan(15);
      expect(Math.abs(stretch.toM - (edges[i]?.[1] ?? 0))).toBeLessThan(15);
      expect(stretch.toM).toBeGreaterThan(stretch.fromM);
    });
    // Touching stretches share their boundary; the gap in the hole is left out.
    expect(out[1]?.fromM).toBe(out[0]?.toM);
    expect(out[2]?.fromM).toBeGreaterThan((out[1]?.toM ?? 0) + 5000);
  });

  it('follows a path with corners and one that stays in a single unit', () => {
    const bent: LonLat[] = [
      [77.05, 18.05],
      [77.05, 18.2],
      [77.15, 18.2],
      [77.15, 18.25],
    ];
    const out = unitsAlong(geo, bent);
    expect(out.map((s) => s.unit.code)).toEqual(['mNh', 'HNt']);
    const total = haversineM(bent[0] as LonLat, bent[1] as LonLat) + haversineM(bent[1] as LonLat, bent[2] as LonLat) + haversineM(bent[2] as LonLat, bent[3] as LonLat);
    expect(out[1]?.toM).toBeCloseTo(total, 3);
    const edge = haversineM(bent[0] as LonLat, bent[1] as LonLat) + haversineM([77.05, 18.2], [77.1, 18.2]);
    expect(Math.abs((out[0]?.toM ?? 0) - edge)).toBeLessThan(15);

    const single = unitsAlong(geo, [
      [77.02, 18.02],
      [77.08, 18.05],
    ]);
    expect(single.length).toBe(1);
    expect(single[0]?.fromM).toBe(0);
  });

  it('accepts path points with heights, and empty or unmapped paths', () => {
    expect(
      unitsAlong(geo, [
        [77.05, 18.2, -2500],
        [77.15, 18.2, -2400],
      ]).map((s) => s.unit.code),
    ).toEqual(['mNh', 'HNt']);
    expect(unitsAlong(geo, [])).toEqual([]);
    expect(unitsAlong(geo, [[77.05, 18.2]]).map((s) => s.unit.code)).toEqual(['mNh']);
    expect(
      unitsAlong(geo, [
        [70, 18],
        [70.1, 18],
      ]),
    ).toEqual([]);
  });
});

describe('ageGa', () => {
  it('puts the Noachian before the Hesperian before the Amazonian', () => {
    const order = [
      'Early Noachian',
      'Middle Noachian',
      'Late Noachian',
      'Early Hesperian',
      'Late Hesperian',
      'Early Amazonian',
      'Middle Amazonian',
      'Late Amazonian',
    ].map((period) => ageGa(unit('x', period)));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1] as number);
    expect(ageGa(unit('x', 'Noachian'))).toBeGreaterThan(ageGa(unit('x', 'Hesperian')));
    expect(ageGa(unit('x', 'Hesperian'))).toBeGreaterThan(ageGa(unit('x', 'Amazonian')));
  });

  it('gives midpoints in billions of years', () => {
    expect(ageGa(unit('mNh', 'Middle Noachian'))).toBeCloseTo((3.94 + 3.83) / 2, 6);
    expect(ageGa(unit('eHv', 'Early Hesperian'))).toBeCloseTo((3.71 + 3.61) / 2, 6);
    expect(ageGa(unit('lAv', 'Late Amazonian'))).toBeCloseTo(0.164, 6);
    expect(EPOCHS_GA.noachian.all[0]).toBeGreaterThan(4);
  });

  it('takes the middle of the whole span for units that cross periods', () => {
    const hnt = ageGa(unit('HNt', 'Hesperian and Noachian'));
    expect(hnt).toBeCloseTo((4.1 + 3.37) / 2, 6);
    expect(ageGa(unit('AHi', 'Amazonian and Hesperian'))).toBeCloseTo(3.71 / 2, 6);
    expect(ageGa(unit('x', 'Late Hesperian to Early Amazonian'))).toBeCloseTo((3.61 + 1.23) / 2, 6);
    expect(ageGa(unit('x', 'Early to Late Amazonian'))).toBeCloseTo(3.37 / 2, 6);
    // Around Jezero: Nili Fossae (mNh) is older than the crater floor (HNt), older than Syrtis lava (eHv).
    expect(ageGa(unit('mNh', 'Middle Noachian'))).toBeGreaterThan(hnt);
    expect(hnt).toBeGreaterThan(ageGa(unit('eHv', 'Early Hesperian')));
  });

  it('falls back to the unit code when the period says nothing', () => {
    const codes = ['eNh', 'mNh', 'lNh', 'HNt', 'eHv', 'lHt', 'AHi', 'mAl', 'lAv'];
    const ages = codes.map((code) => ageGa(unit(code, '')));
    for (let i = 1; i < ages.length; i++) expect(ages[i]).toBeLessThan(ages[i - 1] as number);
    expect(ageGa(unit('mNh', ''))).toBe(ageGa(unit('mNh', 'Middle Noachian')));
    expect(ageGa(unit('HNt', 'unknown'))).toBe(ageGa(unit('x', 'Hesperian and Noachian')));
    expect(ageGa(unit('Apu', ''))).toBe(ageGa(unit('x', 'Amazonian')));
    expect(ageGa(unit('lHl', ''))).toBe(ageGa(unit('x', 'Late Hesperian')));
    expect(ageGa(unit('zz', ''))).toBeNaN();
  });
});
