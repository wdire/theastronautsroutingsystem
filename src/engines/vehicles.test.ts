import { describe, expect, it } from 'vitest';
import type { VehicleId } from './types';
import { speedMs, SUIT_FLAT_KMH, TASK_MINUTES, toblerKmh, VEHICLES } from './vehicles';

const IDS: VehicleId[] = ['foot', 'openRover', 'pressRover', 'robotRover', 'heli'];

describe('VEHICLES', () => {
  it('has the five vehicles, each filed under its own id', () => {
    expect(Object.keys(VEHICLES).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(VEHICLES[id].id).toBe(id);
  });

  it('gives walkers the spec values: two crew, 3.3 km/h, blocked at 25 degrees, 0.9 kg of oxygen, 8 h scrubbers', () => {
    const foot = VEHICLES.foot;
    expect(foot.kind).toBe('walk');
    expect(foot.crew).toBe(2);
    expect(foot.flatSpeedMs * 3.6).toBeCloseTo(3.3, 9);
    expect(foot.blockSlopeDeg).toBe(25);
    expect(foot.o2KgPerPerson).toBe(0.9);
    expect(foot.scrubberH).toBe(8);
    expect(foot.batteryKWh).toBe(0);
    expect(foot.cabin).toBe(false);
    expect(foot.needsDaylight).toBe(true);
  });

  it('gives the pressurised rover a cabin, shielding, 150 kWh plus a 400 kWh range extender, and camping', () => {
    const rover = VEHICLES.pressRover;
    expect(rover.kind).toBe('ground');
    expect(rover.cabin).toBe(true);
    expect(rover.doseFactor).toBeLessThan(1);
    expect(rover.doseFactor).toBeGreaterThan(0);
    expect(rover.batteryKWh).toBe(150);
    expect(rover.extenderKWh).toBe(400);
    expect(rover.canCamp).toBe(true);
    expect(rover.needsDaylight).toBe(false);
  });

  it('keeps the open rover crew on suit air with no shielding', () => {
    const rover = VEHICLES.openRover;
    expect(rover.kind).toBe('ground');
    expect(rover.cabin).toBe(false);
    expect(rover.crew).toBeGreaterThan(0);
    expect(rover.doseFactor).toBe(1);
    expect(rover.o2KgPerPerson).toBe(VEHICLES.foot.o2KgPerPerson);
    expect(rover.scrubberH).toBe(VEHICLES.foot.scrubberH);
    expect(rover.canCamp).toBe(false);
  });

  it('has no crew and no oxygen on the robots', () => {
    for (const id of ['robotRover', 'heli'] as const) {
      expect(VEHICLES[id].crew).toBe(0);
      expect(VEHICLES[id].o2KgPerPerson).toBe(0);
      expect(VEHICLES[id].batteryKWh).toBeGreaterThan(0);
    }
    expect(VEHICLES.heli.kind).toBe('air');
    expect(VEHICLES.robotRover.kind).toBe('ground');
    // Perseverance tops out at about 152 m/h.
    expect(VEHICLES.robotRover.flatSpeedMs * 3600).toBeGreaterThan(100);
    expect(VEHICLES.robotRover.flatSpeedMs * 3600).toBeLessThan(200);
  });

  it('describes every vehicle with sane numbers and one plain sentence', () => {
    for (const id of IDS) {
      const v = VEHICLES[id];
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.blurb).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(v.flatSpeedMs).toBeGreaterThan(0);
      expect(v.comfortSlopeDeg).toBeLessThanOrEqual(v.blockSlopeDeg);
      expect(v.ecoHotelW).toBeLessThanOrEqual(v.hotelW);
      expect(v.massKg).toBeGreaterThan(0);
      expect(v.eyeHeightM).toBeGreaterThan(0);
      expect(v.footprintM[0]).toBeGreaterThan(0);
      expect(v.footprintM[1]).toBeGreaterThan(0);
      expect(v.doseFactor).toBeGreaterThan(0);
      expect(v.doseFactor).toBeLessThanOrEqual(1);
    }
  });
});

describe('toblerKmh', () => {
  it('gives the 3.3 km/h suit cap on flat ground and never more', () => {
    expect(SUIT_FLAT_KMH).toBe(3.3);
    expect(toblerKmh(0)).toBeCloseTo(3.3, 9);
    for (let g = -40; g <= 40; g += 0.5) expect(toblerKmh(g)).toBeLessThanOrEqual(3.3 + 1e-12);
  });

  it('slows on climbs and on steep descents, following Tobler', () => {
    // 6 exp(-3.5 |tan(10 deg) + 0.05|) scaled by 3.3 / 5.037 is 1.78 km/h.
    expect(toblerKmh(10)).toBeCloseTo(1.78, 2);
    expect(toblerKmh(5)).toBeLessThan(toblerKmh(0));
    expect(toblerKmh(15)).toBeLessThan(toblerKmh(10));
    expect(toblerKmh(-20)).toBeLessThan(toblerKmh(-10));
    expect(toblerKmh(-10)).toBeGreaterThan(toblerKmh(10));
    expect(toblerKmh(60)).toBeGreaterThan(0);
  });

  it('copes with a missing grade', () => {
    expect(toblerKmh(Number.NaN)).toBeCloseTo(3.3, 9);
  });
});

describe('speedMs', () => {
  it('walks at the Tobler pace and stops at the 25 degree blocking slope, up or down', () => {
    const foot = VEHICLES.foot;
    expect(speedMs(foot, 0)).toBeCloseTo(3.3 / 3.6, 9);
    expect(speedMs(foot, 10)).toBeCloseTo(toblerKmh(10) / 3.6, 9);
    expect(speedMs(foot, 24.9)).toBeGreaterThan(0);
    expect(speedMs(foot, 25)).toBe(0);
    expect(speedMs(foot, 31)).toBe(0);
    expect(speedMs(foot, -25)).toBe(0);
    expect(speedMs(foot, -24.9)).toBeGreaterThan(0);
  });

  it('drives at the flat speed on level ground, slower on slopes, and not at all past the blocking slope', () => {
    for (const id of ['openRover', 'pressRover', 'robotRover'] as const) {
      const v = VEHICLES[id];
      expect(speedMs(v, 0)).toBeCloseTo(v.flatSpeedMs, 9);
      expect(speedMs(v, v.comfortSlopeDeg)).toBeLessThan(v.flatSpeedMs);
      expect(speedMs(v, v.comfortSlopeDeg)).toBeGreaterThan(0);
      expect(speedMs(v, (v.comfortSlopeDeg + v.blockSlopeDeg) / 2)).toBeLessThan(speedMs(v, v.comfortSlopeDeg));
      expect(speedMs(v, v.blockSlopeDeg - 0.1)).toBeGreaterThan(0);
      expect(speedMs(v, v.blockSlopeDeg)).toBe(0);
      expect(speedMs(v, -v.blockSlopeDeg)).toBe(0);
      expect(speedMs(v, v.blockSlopeDeg + 10)).toBe(0);
      let prev = Infinity;
      for (let g = 0; g < v.blockSlopeDeg; g += 0.5) {
        const s = speedMs(v, g);
        expect(s).toBeLessThanOrEqual(prev);
        prev = s;
      }
    }
  });

  it('flies at the same speed over any ground', () => {
    const heli = VEHICLES.heli;
    expect(speedMs(heli, 0)).toBe(heli.flatSpeedMs);
    expect(speedMs(heli, 40)).toBe(heli.flatSpeedMs);
    expect(speedMs(heli, -70)).toBe(heli.flatSpeedMs);
  });

  it('treats a missing grade as level ground', () => {
    expect(speedMs(VEHICLES.pressRover, Number.NaN)).toBeCloseTo(VEHICLES.pressRover.flatSpeedMs, 9);
  });
});

describe('TASK_MINUTES', () => {
  it('holds the default length of each science task', () => {
    expect(TASK_MINUTES).toEqual({ sample: 45, photo: 10, measure: 20, survey: 60, custom: 15 });
  });
});
