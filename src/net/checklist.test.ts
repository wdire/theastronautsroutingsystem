import { describe, expect, it } from 'vitest';
import { VEHICLES } from '@/engines/vehicles';
import { preEvaChecklist } from './checklist';

describe('pre-EVA checklist', () => {
  it('has the suit checks for a walk, and the budget when there is one', () => {
    const items = preEvaChecklist(VEHICLES.foot, null);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['leak-check', 'prebreathe', 'gloves', 'buddy-check', 'comm-check', 'consumables', 'route-brief']));
    expect(ids).not.toContain('rover-check');
    expect(items.find((i) => i.id === 'consumables')?.detail).toMatch(/Work out the route first/);
  });

  it('swaps suit checks for cabin checks in a pressurised rover', () => {
    const ids = preEvaChecklist(VEHICLES.pressRover, null).map((i) => i.id);
    expect(ids).toContain('cabin-check');
    expect(ids).not.toContain('leak-check');
  });

  it('asks for a command link when no one rides', () => {
    for (const v of [VEHICLES.robotRover, VEHICLES.heli]) {
      const ids = preEvaChecklist(v, null).map((i) => i.id);
      expect(ids).toContain('link-check');
      expect(ids).not.toContain('prebreathe');
    }
  });
});
