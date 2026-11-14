import { describe, expect, it } from 'vitest';
import { createDebounce, encodePlan, parsePlan, samePlan } from './planSync';
import { PLAN } from './testing/world';

function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn: () => void, ms: number) {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id: number) {
      due.delete(id);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...due]) {
        if (t.at <= now) {
          due.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe('plan sync', () => {
  it('sends one update after a burst of edits, with the last value', () => {
    const timers = fakeTimers();
    const sent: number[] = [];
    const d = createDebounce<number>(800, (v) => sent.push(v), timers);
    for (let i = 1; i <= 20; i++) {
      d.push(i);
      timers.advance(100);
    }
    expect(sent).toEqual([]);
    timers.advance(800);
    expect(sent).toEqual([20]);
    expect(d.pending()).toBe(false);
  });

  it('sends a waiting value at once on flush, and nothing after cancel', () => {
    const timers = fakeTimers();
    const sent: string[] = [];
    const d = createDebounce<string>(800, (v) => sent.push(v), timers);
    d.push('a');
    d.flush();
    expect(sent).toEqual(['a']);
    d.flush();
    expect(sent).toEqual(['a']);
    d.push('b');
    d.cancel();
    timers.advance(2000);
    expect(sent).toEqual(['a']);
  });

  it('round-trips a plan and the mission it came from', () => {
    const back = parsePlan(encodePlan({ plan: PLAN, templateId: 'delta-walk' }));
    expect(back?.templateId).toBe('delta-walk');
    expect(back && samePlan(back.plan, PLAN)).toBe(true);
  });

  it('refuses plans that would break the planner or the server', () => {
    const bad = (patch: Record<string, unknown>) => parsePlan(JSON.stringify({ v: 1, plan: { ...PLAN, ...patch }, templateId: null }));
    expect(parsePlan('nope')).toBeNull();
    expect(bad({ vehicle: 'jetpack' })).toBeNull();
    expect(bad({ style: 'scenic' })).toBeNull();
    expect(bad({ start: { lon: 'east', lat: 1 } })).toBeNull();
    expect(bad({ stops: [{ ...PLAN.stops[0], id: 'has spaces' }] })).toBeNull();
    expect(bad({ stops: [{ ...PLAN.stops[0], tasks: [{ id: 't1', kind: 'dance', minutes: 5 }] }] })).toBeNull();
    expect(bad({ roundTrip: 'yes' })).toBeNull();
    expect(bad({ start: null })?.plan.start).toBeNull();
  });
});
