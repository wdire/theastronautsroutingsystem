import { useEffect, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { whenMapReady } from '@/map/instance';

/**
 * A value read from the map and kept fresh while it moves, at most once per frame.
 * `equal` keeps React from re-rendering when the value did not really change.
 */
export function useMapState<T>(read: (map: MapLibreMap) => T, initial: T, equal: (a: T, b: T) => boolean = Object.is): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let raf = 0;
    let map: MapLibreMap | null = null;
    let cancelled = false;
    const update = () => {
      raf = 0;
      if (!map) return;
      const next = read(map);
      setValue((prev) => (equal(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    whenMapReady((m) => {
      if (cancelled) return;
      map = m;
      m.on('move', schedule);
      update();
    });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      map?.off('move', schedule);
    };
    // `read` and `equal` are expected to be stable module-level functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}
