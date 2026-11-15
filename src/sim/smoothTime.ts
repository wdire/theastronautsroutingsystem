import { clockTicking } from './controller';
import type { World } from './types';

/** The longest a frame runs ahead of the last tick, ms: a little over one tick, so a late tick does not show. */
const AHEAD_MS = 120;

/**
 * Mission time for the frame being drawn. The world ticks ten times a second; the screen draws sixty. Between
 * ticks, a moving clock is carried on at its speed, so whatever follows it (the 3D party, the map's crew marker)
 * glides instead of stepping. Each caller keeps its own, since each notices a tick on its own frame.
 */
export function createSmoothTime(): (w: World) => number {
  let seenUtc = Number.NaN;
  let seenAt = 0;
  return (w) => {
    const now = performance.now();
    if (w.utcMs !== seenUtc) {
      seenUtc = w.utcMs;
      seenAt = now;
    }
    if (!clockTicking(w)) return w.utcMs;
    return w.utcMs + Math.min(now - seenAt, AHEAD_MS) * w.speed;
  };
}
