import { describe, expect, it } from 'vitest';
import { decodeUrlState, encodeUrlState, resetUrlApplied, takeInitialUrlState, type UrlState } from './url';

const full: UrlState = {
  camera: { lon: 77.4509, lat: 18.4446, zoom: 12.5, bearing: 30, pitch: 55 },
  plan: {
    start: { lon: 77.4509, lat: 18.4446, placeId: 'octavia-e-butler-landing' },
    stops: [
      {
        id: 's0',
        lon: 77.4012,
        lat: 18.4601,
        name: 'Delta front',
        tasks: [
          { id: 's0t0', kind: 'sample', minutes: 45 },
          { id: 's0t1', kind: 'custom', minutes: 15, label: 'Check the drill' },
        ],
      },
      { id: 's1', lon: 77.36, lat: 18.49, tasks: [] },
    ],
    roundTrip: true,
    vehicle: 'pressRover',
    style: 'eco',
    campAtNight: true,
  },
  departUtcMs: 1_794_000_000_000,
  place: 'cheyava-falls',
};

describe('url state', () => {
  it('round-trips the camera, the plan, the departure and the open place', () => {
    expect(decodeUrlState(encodeUrlState(full))).toEqual(full);
  });

  it('writes nothing for an empty state and leaves defaults out', () => {
    expect(encodeUrlState({})).toBe('');
    const hash = encodeUrlState({
      plan: { start: null, stops: [], roundTrip: true, vehicle: 'foot', style: 'safest', campAtNight: false },
    });
    expect(hash).toBe('');
  });

  it('ignores garbage without throwing', () => {
    for (const hash of [
      '#',
      '#c=abc,def',
      '#c=999,999,99',
      '#from=not-a-point&stops=|||~~~&veh=tank&style=reckless',
      '#stops=77.4,18.4~z99~s0~s99999~p10',
      '#place=%E0%A4%A&t=never',
      '#%%%&&&===',
      '#c=77.45,18.44,12&from=77.45,18.44;%ZZ',
    ]) {
      expect(() => decodeUrlState(hash)).not.toThrow();
    }
    expect(decodeUrlState('#c=999,999,99')).toEqual({});
    expect(decodeUrlState('#veh=tank&style=reckless')).toEqual({});
  });

  it('keeps the valid parts of a damaged hash', () => {
    const s = decodeUrlState('#stops=77.4,18.4~z99~s0~p10|bad|77.5,18.5&veh=openRover');
    expect(s.plan?.vehicle).toBe('openRover');
    expect(s.plan?.stops).toHaveLength(2);
    expect(s.plan?.stops[0]?.tasks).toEqual([{ id: 's0t2', kind: 'photo', minutes: 10 }]);
  });

  it('strips separators from names so they cannot break the hash', () => {
    const state: UrlState = {
      plan: {
        start: { lon: 77.4, lat: 18.4, name: 'A|B~C&D=E#F' },
        stops: [],
        roundTrip: false,
        vehicle: 'foot',
        style: 'safest',
        campAtNight: false,
      },
    };
    const back = decodeUrlState(encodeUrlState(state)).plan;
    expect(back?.start?.name).toBe('A B C D E F');
    expect(back?.roundTrip).toBe(false);
  });

  it('caps the number of stops and tasks', () => {
    const stops = Array.from({ length: 60 }, (_, i) => `77.${String(i).padStart(2, '0')},18.4`).join('|');
    expect(decodeUrlState(`#stops=${stops}`).plan?.stops).toHaveLength(24);
  });

  it('applies the hash once per page load', () => {
    resetUrlApplied();
    expect(takeInitialUrlState('#veh=heli')?.plan?.vehicle).toBe('heli');
    expect(takeInitialUrlState('#veh=heli')).toBeNull();
  });
});
