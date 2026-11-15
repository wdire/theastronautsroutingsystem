import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';
import { isPhone } from '@/lib/device';
import { isOrbiting } from './orbit';

/** The pitch the map leans to at a zoom, degrees: flat over the region, tilting in as the ground comes close. */
export function pitchForZoom(zoom: number): number {
  // On a phone the map leans less: a steep lean fills a tall screen with distant ground, many times the tiles.
  return isPhone() ? Math.min(52, leanFor(zoom)) : leanFor(zoom);
}

function leanFor(zoom: number): number {
  const stops: [number, number][] = [
    [9.5, 0],
    [12, 30],
    [14, 48],
    [16, 60],
    [18, 68],
  ];
  if (zoom <= stops[0]![0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    const [z1, p1] = stops[i]!;
    const [z0, p0] = stops[i - 1]!;
    if (zoom <= z1) return p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0);
  }
  return stops[stops.length - 1]![1];
}

/**
 * Leans the map in as the visitor zooms, the way a 3D map app does: straight down over the region, then
 * tilting smoothly past zoom 10 so craters, the delta and the rim stand up in relief. It follows the zoom
 * while the visitor zooms, and stops the moment they tilt the map themselves; zooming back out to the
 * regional view hands it the tilt again.
 */
/**
 * Who sets the tilt: the zoom ('auto'), the visitor's own drag ('held', handed back to the zoom when they zoom out
 * to the region flat), or the 2D/3D button ('flat' stays straight down at every zoom, 'tilted' keeps the lean).
 */
type TiltOwner = 'auto' | 'held' | 'flat' | 'tilted';
let owner: TiltOwner = 'auto';

/** The 2D/3D button: straight down and staying so, or leaning in and staying so. */
export function chooseTilt(map: MapLibreMap, flat: boolean): void {
  owner = flat ? 'flat' : 'tilted';
  map.easeTo({ pitch: flat ? 0 : Math.max(55, pitchForZoom(map.getZoom())), duration: 600 });
}

/** The visitor took the camera from a flight that leaned in (the circling of a found place): keep its lean. */
export function holdTilt(): void {
  if (owner === 'auto') owner = 'held';
}

/** The pitch a flight should end at: the zoom's, or straight down when the visitor chose 2D. */
export function flightPitch(zoom: number): number {
  return owner === 'flat' ? 0 : pitchForZoom(zoom);
}

export function addAutoTilt(map: MapLibreMap): () => void {
  owner = 'auto';
  const theirsNow = () => owner !== 'auto';

  const idle = () => {
    const s = useApp.getState();
    return s.mode === 'map' && !s.flying && !s.flyover && !s.picking && !isOrbiting();
  };
  const onPitch = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent && owner === 'auto') owner = 'held';
    // Leaning a flat map by hand leaves 2D.
    if (e.originalEvent && owner === 'flat') owner = 'held';
  };
  // While the visitor zooms (wheel, pinch, buttons) the tilt follows each step.
  const onZoom = (e: { originalEvent?: unknown }) => {
    if (theirsNow() || !idle() || !e.originalEvent) return;
    const want = pitchForZoom(map.getZoom());
    if (Math.abs(map.getPitch() - want) > 0.3) map.setPitch(want);
  };
  // After a flight or a jump, ease to the tilt the zoom calls for.
  const onMoveEnd = () => {
    const zoom = map.getZoom();
    if (owner === 'held' && zoom < 8 && map.getPitch() < 5) owner = 'auto';
    if (theirsNow() || !idle()) return;
    const want = pitchForZoom(zoom);
    if (Math.abs(map.getPitch() - want) > 2) map.easeTo({ pitch: want, duration: 700 });
  };
  map.on('pitchstart', onPitch);
  map.on('zoom', onZoom);
  map.on('moveend', onMoveEnd);
  return () => {
    map.off('pitchstart', onPitch);
    map.off('zoom', onZoom);
    map.off('moveend', onMoveEnd);
  };
}
