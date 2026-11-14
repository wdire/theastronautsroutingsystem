import { describe, expect, it } from 'vitest';
import { parseM20 } from './traverseFeed';

const line = (sol: number, from: string, length: number, coords: number[][], sclk = 0) => ({
  properties: { sol, fromRMC: from, length, SCLK_START: sclk },
  geometry: { type: 'LineString', coordinates: coords },
});
const wp = (sol: number, lon: number, lat: number, final = 'y') => ({ properties: { sol, lon, lat, elev_geoid: -2569.94, dist_total_m: sol * 10, final } });

describe('parseM20', () => {
  it('keeps one copy of a drive listed over several sols, thins the line and keeps its end', () => {
    const t = {
      features: [
        line(10, 'a', 5, [[77.45, 18.44, -2570], [77.45001, 18.44, -2570]]),
        // Sol 11 repeats sol 10's drive from the same start, a little longer.
        line(11, 'a', 9, [[77.45, 18.44, -2570], [77.45001, 18.44, -2570], [77.4501, 18.44, -2569]]),
        line(12, 'b', 3, [[77.4501, 18.44, -2569], [77.45011, 18.44, -2569]]),
      ],
    };
    const w = { features: [wp(12, 77.45011, 18.44), wp(11, 77.4501, 18.44), wp(11, 1, 1, 'n')] };
    const out = parseM20(t, w);
    expect(out?.rover).toBe('m20');
    // 0.00001 degrees is about 0.56 m: dropped by the 2 m thinning, except the very end.
    expect(out?.path).toEqual([
      [77.45, 18.44, -2570],
      [77.4501, 18.44, -2569],
      [77.45011, 18.44, -2569],
    ]);
    expect(out?.waypoints.map((x) => x.sol)).toEqual([11, 12]);
    expect(out?.waypoints[0]).toEqual({ sol: 11, lon: 77.4501, lat: 18.44, elev: -2569.9, distKm: 0.11 });
  });

  it('answers null for an empty or broken feed', () => {
    expect(parseM20(null, null)).toBeNull();
    expect(parseM20({ features: [] }, { features: [wp(1, 77, 18)] })).toBeNull();
    expect(parseM20({ features: [line(1, 'a', 1, [[77, 18, 0], [77.1, 18, 0]])] }, { features: [] })).toBeNull();
  });
});
