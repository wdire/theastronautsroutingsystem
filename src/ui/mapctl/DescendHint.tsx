import { useSyncExternalStore } from 'react';
import { Footprints } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { DESCEND_ZOOM, descendProgress, onDescendProgress, standOnGround } from '@/map/descend';
import { getMap } from '@/map/instance';
import { isInRegion } from '@/map/camera';
import { useApp } from '@/store';
import { useMapState } from '@/ui/hooks/useMapState';
import { cn } from '@/lib/cn';

/** Shown from this zoom: close enough that the next step is the ground itself. */
const SHOW_FROM = 17.6;
const readNear = (m: MapLibreMap) => {
  const c = m.getCenter();
  return m.getZoom() >= SHOW_FROM && isInRegion(c.lng, c.lat) ? (m.getZoom() >= DESCEND_ZOOM ? 2 : 1) : 0;
};

/**
 * Close in, the map says that zooming further sets you down on the ground, and fills a bar as you push.
 * On a touch screen, where there is no wheel to push, it is a button.
 */
export function DescendHint({ touch = false }: { touch?: boolean }) {
  const near = useMapState(readNear, 0);
  const progress = useSyncExternalStore(onDescendProgress, descendProgress);
  const busy = useApp((s) => s.mode !== 'map' || s.visor !== null || s.flying || s.world?.run?.status === 'running');
  if (near === 0 || busy) return null;
  const go = () => {
    const map = getMap();
    if (map) standOnGround(map);
  };
  if (touch) {
    return (
      <button type="button" onClick={go} className="panel pointer-events-auto inline-flex h-11 items-center gap-2 px-4 text-[13px] font-medium">
        <Footprints className="size-4 text-primary" aria-hidden />
        Stand on the ground here
      </button>
    );
  }
  return (
    <div className="panel pointer-events-auto relative flex h-9 items-center gap-2 overflow-hidden pr-1 pl-3 text-[12.5px] font-medium motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1" role="status">
      <Footprints className="size-3.5 text-primary" aria-hidden />
      <span className={cn(near === 2 ? 'text-foreground' : 'text-muted-foreground')}>{near === 2 ? 'Keep zooming in to stand on the ground' : 'Zoom in all the way to stand on the ground'}</span>
      <button type="button" onClick={go} className="h-7 rounded-md px-2 text-[12px] font-semibold text-primary hover:bg-secondary">
        Go now
      </button>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-150" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
