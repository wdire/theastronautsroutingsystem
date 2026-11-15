/**
 * A crew member's view of the commander's mission clock. Snapshots arrive about once a second, late and unevenly;
 * shown as they come, the crew would stand still and then leap (at 100x, a hundred seconds at a time). Instead the
 * member runs its own clock at the mission's speed and pulls it gently toward where the last snapshot says the
 * commander is now. Pure: the hook in runSync feeds it real time.
 */

export interface ClockAnchor {
  /** Mission time in the last snapshot, UTC ms. */
  simUtcMs: number;
  /** Real time (performance.now()) when that snapshot arrived. */
  realMs: number;
  speed: number;
  /** The commander's clock was moving. */
  ticking: boolean;
}

/** How long a member runs on without news before it stops and waits, ms of real time. */
export const MAX_AHEAD_MS = 2500;
/** Share of the gap closed each second; small enough not to show, large enough to keep up. */
const CATCH_UP_PER_S = 1.5;

/** Where the commander's clock is now, as far as the last snapshot tells. */
export function predictUtc(a: ClockAnchor, nowRealMs: number): number {
  if (!a.ticking) return a.simUtcMs;
  return a.simUtcMs + Math.max(0, Math.min(nowRealMs - a.realMs, MAX_AHEAD_MS)) * a.speed;
}

/**
 * The member's clock one step on. `display` is what was shown, null at first; `dtMs` the real time since.
 * While the mission moves, the clock never runs backward (a crew walking back a few steps reads as a glitch):
 * if it got ahead, it waits for the commander to catch up. A gap too large to glide over is jumped.
 */
export function followClock(display: number | null, a: ClockAnchor, nowRealMs: number, dtMs: number): number {
  const target = predictUtc(a, nowRealMs);
  if (display === null || !Number.isFinite(display)) return target;
  const gap = target - display;
  if (Math.abs(gap) > Math.max(20_000, a.speed * 4000)) return target;
  const k = Math.min(1, (dtMs / 1000) * CATCH_UP_PER_S);
  if (!a.ticking) return Math.abs(gap) < 1 ? target : display + gap * Math.min(1, k * 2);
  const next = display + dtMs * a.speed + gap * k;
  // Ahead of the commander: slow down, or hold still, rather than step back.
  return Math.max(display, next);
}
