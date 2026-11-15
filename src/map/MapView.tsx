import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from '@/store';
import { createMap, destroyMap, whenMapReady } from './instance';
import { addRunFocus, flyIn, isInRegion, startGlobeSpin } from './camera';
import { setTileHandler, type TileHandler } from './protocol';
import { onTileReady, poolTile } from './protocol/pool';
import type { TileKind } from './protocol/serve';
import { addTerrain } from './terrain';
import { addPlacePicking } from './pick';
import { addDescend } from './descend';
import { addRouteLayers } from './layers/route';
import { addRangeRings } from './layers/rings';
import { addBaseMarker } from './layers/base';
import { addHoverInfo } from './hoverInfo';
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

/** A tile kind made in the tile workers, progressively: a stand-in at once where the full tile waits on the network. */
const fromPool =
  (kind: TileKind): TileHandler =>
  async (_rest, z, x, y, signal) => {
    const served = await poolTile(kind, z, x, y, 'progressive', signal);
    return served.maxAge ? { data: served.bitmap, maxAge: served.maxAge } : served.bitmap;
  };
setTileHandler('img', fromPool('img'));
setTileHandler('hd', fromPool('hd'));
setTileHandler('dem', fromPool('dem'));

/** The map sources each tile kind is drawn by. */
const SOURCES_OF: Partial<Record<TileKind, readonly string[]>> = { img: [SOURCE_BASE], hd: ['hd'], dem: ['dem', 'dem-shade'] };

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

    // A tile first drawn as a stand-in is asked for again once its full version is ready, a frame's worth at a time.
    const toRefresh = new Map<string, { z: number; x: number; y: number }[]>();
    let refreshFrame = 0;
    // A dozen tiles a frame at most: each one is uploaded again, and the terrain redrawn under it.
    const PER_FRAME = 12;
    const flushRefresh = () => {
      refreshFrame = 0;
      let budget = PER_FRAME;
      for (const [id, tiles] of toRefresh) {
        const now = tiles.splice(0, budget);
        budget -= now.length;
        try {
          if (now.length > 0 && map.getSource(id)) map.refreshTiles(id, now);
        } catch {
          // The source went away with a style change; nothing to refresh.
        }
        if (tiles.length === 0) toRefresh.delete(id);
        if (budget <= 0) break;
      }
      if (toRefresh.size > 0) refreshFrame = requestAnimationFrame(flushRefresh);
    };
    cleanups.push(
      onTileReady((kind, z, x, y) => {
        for (const id of SOURCES_OF[kind] ?? []) {
          let list = toRefresh.get(id);
          if (!list) toRefresh.set(id, (list = []));
          list.push({ z, x, y });
        }
        refreshFrame ||= requestAnimationFrame(flushRefresh);
      }),
      () => cancelAnimationFrame(refreshFrame),
    );

    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      if (useApp.getState().mode === 'globe' && isInRegion(e.lngLat.lng, e.lngLat.lat)) flyIn(map);
    };
    map.on('click', onClick);
    cleanups.push(() => map.off('click', onClick));

    whenMapReady((m) => {
      if (!alive) return;
      cleanups.push(addTerrain(m), addRouteLayers(m), addRangeRings(m), addBaseMarker(m), addAutoTilt(m), addOverlays(m), addLabels(m), addHoverInfo(m), addRunFocus(m), addPlacePicking(m), addGlobeMarker(m), addDescend(m));
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

  // While Rover View covers the screen the map shrinks to a single pixel: its canvas, multisampled buffers and
  // the tiles it keeps for a screenful let go of their graphics memory, which Rover View needs. Coming back,
  // it fills in again from the tile workers' memory and the browser's cache.
  const covered = useApp((s) => s.visor !== null);

  // The library sets `position: relative` on its container, so the size comes from a wrapper.
  return (
    <div className={covered ? 'invisible absolute top-0 left-0 size-px overflow-hidden' : 'absolute inset-0'}>
      <div ref={ref} className="size-full" aria-label="Map of Mars" role="application" />
    </div>
  );
}
