import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from '@/store';
import { createMap, destroyMap } from './instance';
import { flyIn, isInRegion, startGlobeSpin } from './camera';
import { setTileHandler } from './protocol';
import { imgTile } from './protocol/img';
import { getCoverage, loadCoverage, onCoverage } from '@/data/coverage';
import { SOURCE_BASE } from './style';

setTileHandler('img', imgTile);

/** The one map of the app. Everything else draws over it. */
export function MapView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const hadCoverage = getCoverage() !== null;
    void loadCoverage();
    const map = createMap(ref.current);
    // If the package index arrives late, the tiles drawn without it are asked for again.
    const offCoverage = onCoverage(() => {
      if (hadCoverage) return;
      const source = map.getSource(SOURCE_BASE);
      if (source && 'setTiles' in source) (source as { setTiles(t: string[]): void }).setTiles(['mars://img/{z}/{x}/{y}']);
    });
    const stopSpin = startGlobeSpin(map);
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      if (useApp.getState().mode === 'globe' && isInRegion(e.lngLat.lng, e.lngLat.lat)) flyIn(map);
    };
    map.on('click', onClick);
    return () => {
      stopSpin();
      offCoverage();
      map.off('click', onClick);
      destroyMap();
    };
  }, []);

  // The library sets `position: relative` on its container, so the size comes from a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={ref} className="size-full" aria-label="Map of Mars" role="application" />
    </div>
  );
}
