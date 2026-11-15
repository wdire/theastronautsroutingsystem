/**
 * Loads the tiles of a view before the camera gets there (the landing at the end of the flight in): the
 * sources each tile is built from land in their caches and the browser's, so when the map asks for the
 * tiles they are put together from memory instead of the network.
 */
import { lonToPx, latToPx } from '@/lib/geo';
import { poolTile } from './protocol/pool';

export function warmView(center: readonly [number, number], zoom: number): void {
  const retina = typeof window !== 'undefined' && window.devicePixelRatio >= 1.5;
  // The tile zoom the map will ask for (one finer on a high-density screen), and the level above it.
  const z = Math.min(19, Math.round(zoom) + (retina ? 1 : 0));
  const signal = new AbortController().signal;
  for (const tz of [z - 1, z]) {
    const cx = Math.floor(lonToPx(center[0], tz) / 256);
    const cy = Math.floor(latToPx(center[1], tz) / 256);
    const r = tz === z ? 2 : 1;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r - 1; dx <= r + 1; dx += 1) {
        // Whole tiles, kept in the workers' memory: when the map asks, they are handed over as they are.
        void poolTile('img', tz, cx + dx, cy + dy, 'full', signal).then((s) => s.bitmap.close(), () => undefined);
        if (tz >= 14) void poolTile('hd', tz, cx + dx, cy + dy, 'full', signal).then((s) => s.bitmap.close(), () => undefined);
      }
    }
  }
  // The elevation under the view, for the relief.
  const dz = Math.min(14, Math.round(zoom));
  const dx0 = Math.floor(lonToPx(center[0], dz) / 256);
  const dy0 = Math.floor(latToPx(center[1], dz) / 256);
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) void poolTile('dem', dz, dx0 + dx, dy0 + dy, 'full', signal).then((s) => s.bitmap.close(), () => undefined);
}
