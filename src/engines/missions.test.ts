import { describe, expect, it } from 'vitest';
import { MISSIONS, missionById, toPlan } from './missions';
import type { Mission, MissionOutcome } from './missions';
import { inBox, REGION } from '../lib/constants';

function clean(m: Mission): MissionOutcome {
  const planned = m.stops.reduce((n, s) => n + s.tasks.length, 0);
  return {
    tasksDone: planned,
    tasksPlanned: planned,
    endedAt: m.roundTrip ? 'start' : 'lastStop',
    o2LeftFrac: m.vehicle === 'heli' ? null : 0.5,
    batteryLeftFrac: m.vehicle === 'foot' ? null : 0.5,
    hours: 3,
  };
}

describe('MISSIONS', () => {
  it('has the four scenarios, one per vehicle', () => {
    expect(MISSIONS.map((m) => [m.id, m.vehicle])).toEqual([
      ['delta', 'foot'],
      ['breach', 'pressRover'],
      ['rim', 'openRover'],
      ['belva', 'heli'],
    ]);
    expect(missionById('rim')?.title).toBe('West rim survey');
  });

  it('keeps every position inside the region', () => {
    for (const m of MISSIONS) {
      for (const p of [m.start, ...m.stops.map((s) => s.place)]) {
        expect(inBox(REGION, p.lon, p.lat), `${m.id}: ${p.name}`).toBe(true);
      }
    }
  });

  it('has a one-sentence brief and at least one task at every stop', () => {
    for (const m of MISSIONS) {
      expect(m.brief.split(/\.\s/).length, m.id).toBe(1);
      expect(m.brief.endsWith('.')).toBe(true);
      for (const s of m.stops) expect(s.tasks.length).toBeGreaterThan(0);
    }
  });
});

describe('toPlan', () => {
  it('gives a fresh plan with unique ids every time', () => {
    const ids: string[] = [];
    for (const m of [...MISSIONS, ...MISSIONS]) {
      const plan = toPlan(m);
      expect(plan.vehicle).toBe(m.vehicle);
      expect(plan.start?.name).toBe(m.start.name);
      expect(plan.stops).toHaveLength(m.stops.length);
      for (const s of plan.stops) ids.push(s.id, ...s.tasks.map((t) => t.id));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each task its default length and links known sites to the place data', () => {
    const plan = toPlan(missionById('delta')!);
    expect(plan.stops[0]?.tasks.map((t) => [t.kind, t.minutes])).toEqual([
      ['sample', 45],
      ['photo', 10],
    ]);
    expect(plan.start?.placeId).toBe('place:three-forks');
  });
});

describe('judge', () => {
  for (const m of MISSIONS) {
    describe(m.id, () => {
      it('passes a clean run', () => {
        const v = m.judge(clean(m));
        expect(v.success).toBe(true);
        expect(v.line).toMatch(/^Success: /);
      });

      it('fails with tasks left undone', () => {
        const v = m.judge({ ...clean(m), tasksDone: clean(m).tasksPlanned - 1 });
        expect(v.success).toBe(false);
        expect(v.line).toContain('left undone');
      });

      it('fails when the crew is not home', () => {
        const v = m.judge({ ...clean(m), endedAt: 'elsewhere' });
        expect(v.success).toBe(false);
        expect(v.line).toContain('did not get back');
      });

      it('fails when a reserve is spent', () => {
        const v = m.judge({ ...clean(m), o2LeftFrac: clean(m).o2LeftFrac === null ? null : 0.01, batteryLeftFrac: clean(m).batteryLeftFrac === null ? null : 0.01 });
        expect(v.success).toBe(false);
        expect(v.line).toContain('reserve');
      });
    });
  }
});
