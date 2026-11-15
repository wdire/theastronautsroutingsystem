/**
 * Whether this is a phone: a touch screen whose short side is a phone's. Phones draw the map and Rover View
 * with fewer pixels and tiles than a desktop: a phone's graphics and memory are a fraction of a laptop's, and
 * on its small, dense screen the difference is hard to see.
 */
export function isPhone(): boolean {
  if (typeof window === 'undefined' || typeof matchMedia !== 'function') return false;
  const short = Math.min(window.screen?.width ?? window.innerWidth, window.screen?.height ?? window.innerHeight);
  return matchMedia('(pointer: coarse)').matches && short < 600;
}

/** The pixel ratio to draw at: the screen's own, at most 2 on a phone (its screen is often 3). */
export function drawRatio(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return isPhone() ? Math.min(2, dpr) : dpr;
}
