import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';

/** The pitch the map leans to at a zoom, degrees: flat over the region, tilting in as the ground comes close. */
export function pitchForZoom(zoom: number): number {
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
export function addAutoTilt(map: MapLibreMap): () => void {
  let theirs = false;

  const idle = () => {
    const s = useApp.getState();
    return s.mode === 'map' && !s.flying && !s.flyover && !s.picking;
  };
  const onPitch = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) theirs = true;
  };
  // While the visitor zooms (wheel, pinch, buttons) the tilt follows each step.
  const onZoom = (e: { originalEvent?: unknown }) => {
    if (theirs || !idle() || !e.originalEvent) return;
    const want = pitchForZoom(map.getZoom());
    if (Math.abs(map.getPitch() - want) > 0.3) map.setPitch(want);
  };
  // After a flight or a jump, ease to the tilt the zoom calls for.
  const onMoveEnd = () => {
    const zoom = map.getZoom();
    if (theirs && zoom < 8 && map.getPitch() < 5) theirs = false;
    if (theirs || !idle()) return;
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
