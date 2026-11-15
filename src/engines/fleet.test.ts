import { describe, expect, it } from 'vitest';
import { checkFleet, fleetOf, peopleOf, vehicleFacts, withFleet } from './fleet';
import { VEHICLES } from './vehicles';
import type { MissionPlan } from './types';

const plan: MissionPlan = { start: null, stops: [], roundTrip: true, vehicle: 'foot', style: 'safest', campAtNight: false };

describe('fleet', () => {
  it('reads plans from before fleets as one vehicle and its usual crew', () => {
    expect(fleetOf({ vehicle: 'openRover' })).toEqual([{ vehicle: 'openRover', count: 1 }]);
    expect(fleetOf({ vehicle: 'foot' })).toEqual([]);
    expect(peopleOf({ vehicle: 'foot' })).toBe(2);
    expect(peopleOf({ vehicle: 'heli' })).toBe(0);
  });

  it('walks everyone when there are more people than seats', () => {
    const c = checkFleet([{ vehicle: 'openRover', count: 1 }], 3);
    expect(c.pace).toBe('foot');
    expect(c.walkers).toBe(1);
    expect(c.problems).toEqual([]);
    expect(c.notes[0]).toMatch(/walking pace/);
  });

  it('rides when everyone has a seat, and the open rover sets the air limit before a cabin', () => {
    expect(checkFleet([{ vehicle: 'openRover', count: 2 }], 4).pace).toBe('openRover');
    expect(checkFleet([{ vehicle: 'pressRover', count: 1 }], 2).pace).toBe('pressRover');
    expect(checkFleet([{ vehicle: 'pressRover', count: 1 }, { vehicle: 'openRover', count: 1 }], 4).pace).toBe('openRover');
  });

  it('refuses rovers without drivers, and a mission with nobody and nothing', () => {
    expect(checkFleet([{ vehicle: 'openRover', count: 2 }], 1).problems[0]).toMatch(/2 drivers/);
    expect(checkFleet([], 0).problems[0]).toMatch(/Nobody is going/);
    expect(checkFleet([{ vehicle: 'openRover', count: 1 }], 0).problems.length).toBeGreaterThan(0);
  });

  it('sends robots alone, and robots never set the pace with people', () => {
    expect(checkFleet([{ vehicle: 'heli', count: 1 }], 0).pace).toBe('heli');
    expect(checkFleet([{ vehicle: 'robotRover', count: 1 }, { vehicle: 'heli', count: 2 }], 0).pace).toBe('robotRover');
    expect(checkFleet([{ vehicle: 'robotRover', count: 1 }], 2).pace).toBe('foot');
  });

  it('keeps the plan vehicle in step with the fleet', () => {
    const next = withFleet(plan, [{ vehicle: 'pressRover', count: 1 }, { vehicle: 'heli', count: 9 }], 2);
    expect(next.vehicle).toBe('pressRover');
    expect(next.fleet).toEqual([
      { vehicle: 'pressRover', count: 1 },
      { vehicle: 'heli', count: 4 },
    ]);
  });

  it('gives round-number facts for the info card', () => {
    const open = vehicleFacts(VEHICLES.openRover);
    expect(open.seats).toBe('2 people');
    expect(open.range).toMatch(/km out and back/);
    expect(vehicleFacts(VEHICLES.heli).air).toBeNull();
    expect(vehicleFacts(VEHICLES.robotRover).range).toMatch(/a sol/);
  });
});
