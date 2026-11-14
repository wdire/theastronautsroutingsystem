/** A phone bottom sheet rests at one of three heights. */
export type SheetStop = 'peek' | 'half' | 'full';

export const STOPS: readonly SheetStop[] = ['peek', 'half', 'full'];
export const STOP_WORD: Record<SheetStop, string> = { peek: 'small', half: 'half height', full: 'full height' };


/** The sheet’s height at each stop, for a viewport and the space kept clear above and below it. */
export function sheetHeights(viewportH: number, topClear: number, bottomClear: number): Record<SheetStop, number> {
  const full = Math.max(220, viewportH - topClear - bottomClear);
  return { peek: Math.min(132, full), half: Math.min(full, Math.round((viewportH - bottomClear) * 0.52)), full };
}

/** Where a drag that ends at `height`, moving up at `velocity` px/ms, should settle. */
export function settle(height: number, velocity: number, heights: Record<SheetStop, number>): SheetStop {
  // A flick carries on for a moment after the finger lifts.
  const projected = height + velocity * 160;
  let best: SheetStop = 'half';
  for (const stop of STOPS) if (Math.abs(heights[stop] - projected) < Math.abs(heights[best] - projected)) best = stop;
  return best;
}
