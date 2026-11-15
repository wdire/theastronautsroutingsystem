import { describe, expect, it } from 'vitest';
import { followClock, MAX_AHEAD_MS, predictUtc, type ClockAnchor } from './smoothClock';

const anchor = (o: Partial<ClockAnchor> = {}): ClockAnchor => ({ simUtcMs: 1_000_000, realMs: 0, speed: 100, ticking: true, ...o });

/** Runs the member clock at 10 Hz for `ms` of real time, with a new snapshot every `every` ms arriving `late` ms late. */
function simulate(ms: number, every: number, late: number, speed = 100) {
  let display: number | null = null;
  let a = anchor({ speed });
  const shown: number[] = [];
  for (let t = 0; t <= ms; t += 100) {
    if (t % every === 0 && t >= late) a = anchor({ speed, simUtcMs: 1_000_000 + (t - late) * speed, realMs: t });
    display = followClock(display, a, t, 100);
    shown.push(display);
  }
  return shown;
}

describe('the member clock', () => {
  it('runs on at the mission speed between snapshots, and stops after a while without news', () => {
    expect(predictUtc(anchor(), 500)).toBe(1_000_000 + 500 * 100);
    expect(predictUtc(anchor(), 60_000)).toBe(1_000_000 + MAX_AHEAD_MS * 100);
    expect(predictUtc(anchor({ ticking: false }), 500)).toBe(1_000_000);
  });

  it('moves in even steps at 100x with snapshots a second apart, never backward', () => {
    const shown = simulate(10_000, 1000, 120);
    const steps = shown.slice(20).map((v, i) => v - (shown[19 + i] ?? v));
    for (const s of steps) {
      expect(s).toBeGreaterThanOrEqual(0);
      // A tenth of a second at 100x is 10 s of mission time; no step strays far from it.
      expect(s).toBeGreaterThan(10_000 * 0.6);
      expect(s).toBeLessThan(10_000 * 1.4);
    }
  });

  it('jumps a gap too large to glide over, and eases to a stopped clock', () => {
    expect(followClock(0, anchor(), 0, 100)).toBe(1_000_000);
    const stopped = anchor({ ticking: false });
    let d = 1_000_000 - 2000;
    for (let i = 0; i < 40; i++) d = followClock(d, stopped, i * 100, 100);
    expect(d).toBe(1_000_000);
  });
});
