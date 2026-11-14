import { Layers, LocateFixed, Minus, Navigation2, Plus } from 'lucide-react';
import { getMap } from '@/map/instance';
import { LANDING_SITE } from '@/lib/constants';
import { useApp } from '@/store';
import { useMapState } from '@/ui/hooks/useMapState';
import { IconButton } from '@/ui/shell/IconButton';

const readBearing = (m: { getBearing(): number }) => Math.round(m.getBearing());
const readPitch = (m: { getPitch(): number }) => Math.round(m.getPitch());

/** Bottom right: layers, tilt, north, the landing site, and zoom. */
export function MapButtons() {
  const bearing = useMapState(readBearing, 0);
  const pitch = useMapState(readPitch, 0);
  const layersOpen = useApp((s) => s.dock === 'layers');
  const toggleDock = useApp((s) => s.toggleDock);
  const tilted = pitch > 5;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="panel flex flex-col p-0.5">
        <IconButton label="Map layers" active={layersOpen} onClick={() => toggleDock('layers')}>
          <Layers />
        </IconButton>
        <IconButton
          label={tilted ? 'Look straight down' : 'Tilt the view'}
          active={tilted}
          onClick={() => getMap()?.easeTo({ pitch: tilted ? 0 : 55, duration: 500 })}
        >
          <span className="figure text-[13px] font-semibold tracking-tight">{tilted ? '2D' : '3D'}</span>
        </IconButton>
        <IconButton
          label={bearing === 0 ? 'North is up' : 'Turn north up'}
          onClick={() => getMap()?.easeTo({ bearing: 0, duration: 400 })}
        >
          <Navigation2 style={{ transform: `rotate(${-bearing}deg)` }} className="transition-transform duration-150" />
        </IconButton>
        <IconButton
          label="Go to the Perseverance landing site"
          onClick={() => getMap()?.flyTo({ center: [LANDING_SITE[0], LANDING_SITE[1]], zoom: 13.5, duration: 2200 })}
        >
          <LocateFixed />
        </IconButton>
      </div>
      <div className="panel flex flex-col p-0.5">
        <IconButton label="Zoom in" onClick={() => getMap()?.zoomIn({ duration: 250 })}>
          <Plus />
        </IconButton>
        <div className="mx-2 h-px bg-border" aria-hidden />
        <IconButton label="Zoom out" onClick={() => getMap()?.zoomOut({ duration: 250 })}>
          <Minus />
        </IconButton>
      </div>
    </div>
  );
}
