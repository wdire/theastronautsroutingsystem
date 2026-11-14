import { describe, expect, it } from 'vitest';
import { abortMission, tick } from '@/sim/world';
import { alertLine, buildDebrief, fmtDelta, parseDebrief, planTaskId, tasksByStop, timelineOf, type DebriefInput } from './debrief';
import { plannedFrom } from './snapshot';
import { startedWorld } from './testing/world';

function input(over: Partial<DebriefInput> = {}): DebriefInput {
  const w = tick(startedWorld(), 3 * 3600);
  const run = w.run!;
  return {
    mission: { title: 'Delta walk', objective: 'Sample the delta front.', vehicle: 'foot', siteName: 'Base camp', plannedStartUtc: run.startedUtcMs - 600_000 },
    crew: [
      { _id: 'c1', kind: 'human', name: 'Arsia 7', role: 'Commander', color: 'flare', state: 'joined' },
      { _id: 'c2', kind: 'android', name: 'AND-4 Olivine', role: 'Field Geologist', color: 'graphite', state: 'joined' },
      { _id: 'c3', kind: 'human', name: 'Gale 2', role: 'Navigator', color: 'cobalt', state: 'invited' },
      { _id: 'c4', kind: 'human', name: 'Hellas 9', role: 'Crew Engineer', color: 'ochre', state: 'left' },
    ],
    assignments: { t1: 'c2' },
    world: w,
    planned: plannedFrom(run.trip, run.startedUtcMs, run.startLevels),
    log: [
      { authorName: 'System', kind: 'system', text: 'Set out from Base camp: 1 stop, 2.0 km, about 1 h 6 min.', missionUtcMs: run.startedUtcMs },
      { authorName: 'Arsia 7', kind: 'radio', text: 'Leaving the habitat.', missionUtcMs: run.startedUtcMs + 60_000 },
      { authorName: 'System', kind: 'system', text: 'Arsia 7 joined the crew.', missionUtcMs: null },
      { authorName: 'System', kind: 'system', text: 'Done: Take a sample at Delta front (AND-4 Olivine).', missionUtcMs: run.startedUtcMs + 1_200_000, taskId: 't1' },
    ],
    colorOf: (c) => (c === 'graphite' ? '#5c6166' : '#ffffff'),
    fallbackLon: 77.4,
    ...over,
  };
}

describe('debrief', () => {
  it('records the crew, the tasks with their assignees, and the outcome', () => {
    const d = buildDebrief(input());
    expect(d.crew.map((c) => c.name)).toEqual(['Arsia 7', 'AND-4 Olivine', 'Hellas 9']);
    expect(d.crew[1]).toMatchObject({ android: true, color: '#5c6166' });
    expect(d.crew[2]!.left).toBe(true);
    expect(d.tasks).toHaveLength(1);
    expect(d.tasks[0]).toMatchObject({ stopName: 'Delta front', assignee: 'AND-4 Olivine', state: 'done' });
    expect(d.actual?.kind).toBe('arrived');
    expect(d.actual?.tasksDone).toBe(1);
    expect(d.planned?.distM).toBeGreaterThan(1900);
    expect(d.routeChanges).toBe(0);
    expect(d.messages.length).toBeGreaterThan(0);
  });

  it('survives a trip through JSON, and refuses what it cannot read', () => {
    const d = buildDebrief(input());
    expect(parseDebrief(JSON.stringify(d))).toEqual(d);
    expect(parseDebrief(null)).toBeNull();
    expect(parseDebrief('{')).toBeNull();
    expect(parseDebrief(JSON.stringify({ ...d, v: 2 }))).toBeNull();
    expect(parseDebrief(JSON.stringify({ ...d, vehicle: 'warp drive' }))).toBeNull();
    // A broken entry in a list is dropped; the rest is kept.
    const parsed = parseDebrief(JSON.stringify({ ...d, tasks: [...d.tasks, { id: 7 }] }));
    expect(parsed?.tasks).toHaveLength(1);
  });

  it('records a cancelled mission without a run', () => {
    const d = buildDebrief(input({ world: null, planned: null }));
    expect(d.actual).toBeNull();
    expect(d.startedUtcMs).toBeNull();
    expect(d.tasks).toEqual([]);
    expect(timelineOf(d).some((e) => e.kind === 'start' || e.kind === 'end')).toBe(false);
  });

  it('marks an aborted run', () => {
    const w = abortMission(tick(startedWorld(), 600));
    const d = buildDebrief(input({ world: w }));
    expect(d.actual?.kind).toBe('aborted');
    expect(d.tasks[0]!.state).toBe('skipped');
  });

  it('tells the story in mission time, each thing once', () => {
    const d = buildDebrief(input());
    const events = timelineOf(d, [{ text: 'Grit in the left glove.', missionUtcMs: d.startedUtcMs! + 90_000 }, { text: 'Written before the run.', missionUtcMs: null }]);
    expect(events[0]).toMatchObject({ kind: 'start', text: expect.stringContaining('Set out from Base camp') });
    expect(events[events.length - 1]!.kind).toBe('end');
    expect(events.map((e) => e.kind)).toEqual([...events.map((e) => e.kind)].sort((a, b) => events.findIndex((e) => e.kind === a) - events.findIndex((e) => e.kind === b)));
    for (let i = 1; i < events.length; i++) expect(events[i]!.atUtcMs).toBeGreaterThanOrEqual(events[i - 1]!.atUtcMs);
    expect(events.filter((e) => e.kind === 'start')).toHaveLength(1);
    expect(events.find((e) => e.kind === 'radio')).toMatchObject({ who: 'Arsia 7' });
    expect(events.find((e) => e.kind === 'task')?.text).toContain('Done: Take a sample');
    expect(events.find((e) => e.kind === 'private')?.text).toBe('Grit in the left glove.');
    expect(events.some((e) => e.text.includes('joined the crew'))).toBe(false);
    // Alert lines in the log are shown once, from the alert list.
    const alert = d.alerts[0];
    if (alert) {
      const withLine = { ...d, log: [...d.log, { atUtcMs: alert.atUtcMs, author: 'System', kind: 'system' as const, text: alertLine(alert), taskId: null }] };
      expect(timelineOf(withLine).filter((e) => e.text.startsWith(alert.title))).toHaveLength(1);
    }
  });

  it('says how far off the plan things went', () => {
    // The figures keep their unit on the same line with a no-break space, as everywhere in the app.
    expect(fmtDelta('duration', 3600, 3600 + 38 * 60)).toMatch(/^\+38\smin$/);
    expect(fmtDelta('duration', 3600, 3630)).toBe('as planned');
    expect(fmtDelta('distance', 2000, 800)).toMatch(/^−1\.2\skm$/);
    expect(fmtDelta('fraction', 0.6, 0.52)).toBe('−8 points');
    expect(fmtDelta('fraction', 0.6, 0.61)).toBe('+1 point');
    expect(fmtDelta('dose', 0.1, 0.13)).toBe('+0.03 mSv');
    expect(fmtDelta('dose', null, 0.13)).toBe('');
  });

  it('groups tasks by stop, in order', () => {
    const t = (id: string, stopName: string) => ({ id, stopName, label: id, minutes: 5, state: 'done' as const, assignee: null });
    expect(tasksByStop([t('a', 'One'), t('b', 'One'), t('c', 'Two')]).map((g) => [g.stopName, g.tasks.length])).toEqual([
      ['One', 2],
      ['Two', 1],
    ]);
  });

  it('finds the plan task behind a run task', () => {
    expect(planTaskId('s1:t1')).toBe('t1');
    expect(planTaskId('t9')).toBe('t9');
  });
});
