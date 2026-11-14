import { describe, expect, it } from 'vitest';
import { parseStationFeed } from './stationFeed';

// Rows as mars.nasa.gov sent them on 2026-11-14.
const REMS = {
  descriptions: {},
  soles: [
    { id: '4746', terrestrial_date: '2026-08-25', sol: '4995', min_temp: '-71', max_temp: '-5', pressure: '777', abs_humidity: '--' },
    { id: '4745', terrestrial_date: '2026-08-24', sol: '4994', min_temp: '-72', max_temp: '-4', pressure: '779' },
    { id: '4744', terrestrial_date: '2026-08-23', sol: '4993', min_temp: '--', max_temp: '--', pressure: '--' },
  ],
};
const MEDA = {
  sols: [
    { terrestrial_date: '2024-04-21', sol: '1127', min_temp: '--', max_temp: '--', pressure: '--', sunrise: '06:13:15' },
    { terrestrial_date: '2024-04-27', sol: '1133', min_temp: -79.3, max_temp: -24.7, pressure: 778.9, sunrise: '06:18:07' },
  ],
};

describe('parseStationFeed', () => {
  it("reads Curiosity's feed: strings to numbers, newest last, empty sols skipped", () => {
    const sols = parseStationFeed(REMS);
    expect(sols.map((s) => s.sol)).toEqual([4994, 4995]);
    expect(sols.at(-1)).toEqual({ sol: 4995, earthDate: '2026-08-25', minC: -71, maxC: -5, pressurePa: 777 });
  });
  it("reads Perseverance's feed, which uses numbers and another key", () => {
    expect(parseStationFeed(MEDA)).toEqual([{ sol: 1133, earthDate: '2024-04-27', minC: -79.3, maxC: -24.7, pressurePa: 778.9 }]);
  });
  it('keeps only the newest few', () => {
    expect(parseStationFeed(REMS, 1).map((s) => s.sol)).toEqual([4995]);
  });
  it('drops glitches and junk', () => {
    const junk = { soles: [null, 7, { sol: '12', terrestrial_date: 'yesterday', min_temp: '-70' }, { sol: '13', terrestrial_date: '2026-01-01', min_temp: '-999', max_temp: '80', pressure: '5' }] };
    expect(parseStationFeed(junk)).toEqual([]);
    expect(parseStationFeed('<html>')).toEqual([]);
    expect(parseStationFeed(null)).toEqual([]);
  });
});
