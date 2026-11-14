import { describe, expect, it } from 'vitest';
import { forceEvent } from '@/sim/events';
import { abortMission, tick } from '@/sim/world';
import { runEvents } from './events';
import { startedWorld } from './testing/world';

describe('run events for the crew log', () => {
  it('says nothing about a world seen for the first time', () => {
    expect(runEvents(null, tick(startedWorld(), 3600))).toEqual([]);
  });

  it('logs a task done, with who was given it', () => {
    const a = tick(startedWorld(), 60);
    const b = tick(a, 3 * 3600);
    const events = runEvents(a, b, (id) => (id === 't1' ? 'AND-4 Olivine' : null));
    const task = events.find((e) => e.taskId === 't1');
    expect(task?.text).toMatch(/^Done: .+ at Delta front \(AND-4 Olivine\)\.$/);
    expect(events.some((e) => e.text.startsWith('Mission over.'))).toBe(true);
  });

  it('logs an alert once, when it is raised', () => {
    const a = tick(startedWorld(), 60);
    const b = forceEvent(a, 'solar');
    const first = runEvents(a, b);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]!.text).toMatch(/^(Note|Advisory|Caution|Warning): /);
    expect(runEvents(b, b)).toEqual([]);
  });

  it('logs an aborted run and the tasks it skipped', () => {
    const a = tick(startedWorld(), 60);
    const events = runEvents(a, abortMission(a));
    expect(events.some((e) => e.text.startsWith('Skipped:'))).toBe(true);
    expect(events.some((e) => e.text.startsWith('Mission over.'))).toBe(true);
  });

  it('logs a route change', () => {
    const a = tick(startedWorld(), 60);
    const b = { ...a, run: { ...a.run!, leg: 1 } };
    expect(runEvents(a, b).some((e) => e.text.startsWith('Route changed.'))).toBe(true);
  });
});
