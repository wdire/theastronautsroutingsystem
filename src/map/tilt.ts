import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';

const TILT_AT_ZOOM = 10;
const LEVEL_BELOW_ZOOM = 7;

/**
 * Tilts the view once, the first time the visitor comes down past zoom 10: seen straight down, a
 * crater 45 km wide and 500 m deep reads as a flat ring, and most visitors never find the tilt
 * themselves. It never happens again, never if they have tilted the map on their own, and the view
 * levels again if they zoom back out to the regional view.
 */
export function addAutoTilt(map: MapLibreMap): () => void {
  let before = map.getZoom();
  let done = false;
  let ours = false;
  let theirs = false;

  const onPitch = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) theirs = true;
  };
  const onMoveEnd = () => {
    const zoom = map.getZoom();
    const cameDown = before < TILT_AT_ZOOM && zoom >= TILT_AT_ZOOM;
    before = zoom;
    const s = useApp.getState();
    if (s.mode !== 'map' || s.flying || s.flyover) return;
    if (cameDown && !done && !theirs && map.getPitch() < 5) {
      done = true;
      ours = true;
      map.easeTo({ pitch: 55, duration: 900 });
    } else if (ours && zoom < LEVEL_BELOW_ZOOM && map.getPitch() > 5) {
      ours = false;
      map.easeTo({ pitch: 0, duration: 700 });
    }
  };
  map.on('pitchstart', onPitch);
  map.on('moveend', onMoveEnd);
  return () => {
    map.off('pitchstart', onPitch);
    map.off('moveend', onMoveEnd);
  };
}
