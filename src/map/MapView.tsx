import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from '@/store';
import { createMap, destroyMap, whenMapReady } from './instance';
import { flyIn, isInRegion, startGlobeSpin } from './camera';
import { setTileHandler } from './protocol';
import { mapImgTile } from './protocol/tone';
import { demTile } from './protocol/dem';
import { addTerrain } from './terrain';
import { addPlacePicking } from './pick';
import { addDescend } from './descend';
import { addRouteLayers } from './layers/route';
import { addRangeRings } from './layers/rings';
import { addAutoTilt } from './tilt';
import { addOverlays } from './layers/overlays';
import { addLabels } from './layers/labels';
import { startPlanner } from '@/planner/controller';
import { addGlobeMarker } from './globeMarker';
import { setReadoutSampler } from './readout';
import { SOURCE_BASE } from './style';
import { getCoverage, loadCoverage, onCoverage } from '@/data/coverage';
import { groundAtCached } from '@/data/dem';
import { marsTime } from '@/engines/marsTime';
import { fmtClock, fmtDeg, fmtElevation } from '@/lib/format';

setTileHandler('img', mapImgTile);
setTileHandler('dem', demTile);

/** The one map of the app. Everything else draws over it. */
export function MapView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const hadCoverage = getCoverage() !== null;
    void loadCoverage();
    const map = createMap(ref.current);
    const cleanups: (() => void)[] = [];
    let alive = true;

    // If the package index arrives late, the tiles drawn without it are asked for again.
    cleanups.push(
      onCoverage(() => {
        if (hadCoverage) return;
        for (const [id, tiles] of [
          [SOURCE_BASE, 'mars://img/{z}/{x}/{y}'],
          ['dem', 'mars://dem/{z}/{x}/{y}'],
          ['dem-shade', 'mars://dem/{z}/{x}/{y}'],
        ] as const) {
          const source = map.getSource(id);
          if (source && 'setTiles' in source) (source as { setTiles(t: string[]): void }).setTiles([tiles]);
        }
      }),
    );
    cleanups.push(startGlobeSpin(map), startPlanner());

    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      if (useApp.getState().mode === 'globe' && isInRegion(e.lngLat.lng, e.lngLat.lat)) flyIn(map);
    };
    map.on('click', onClick);
    cleanups.push(() => map.off('click', onClick));

    whenMapReady((m) => {
      if (!alive) return;
      cleanups.push(addTerrain(m), addRouteLayers(m), addRangeRings(m), addAutoTilt(m), addOverlays(m), addLabels(m), addPlacePicking(m), addGlobeMarker(m), addDescend(m));
      // The mission's layers bring the simulation with them; nobody needs that to see the planet, so it loads after.
      void import('./layers/mission').then(({ addMissionLayers }) => {
        if (alive) cleanups.push(addMissionLayers(m));
      });
    });

    setReadoutSampler((lon, lat) => {
      const out: string[] = [];
      const ground = groundAtCached(lon, lat, map.getZoom() + 1);
      if (ground) {
        out.push(fmtElevation(ground.elev));
        out.push(`slope ${fmtDeg(ground.slopeDeg, ground.slopeDeg < 10 ? 1 : 0)}`);
      }
      out.push(`${fmtClock(marsTime(useApp.getState().utcMs, lon).ltstH)} LTST`);
      return out;
    });

    return () => {
      alive = false;
      for (const fn of cleanups) fn();
      setReadoutSampler(() => []);
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
