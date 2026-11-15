import { Binoculars, LocateFixed, Minus, Navigation2, Plus } from 'lucide-react';
import { getMap } from '@/map/instance';
import { chooseTilt } from '@/map/tilt';
import { LANDING_SITE } from '@/lib/constants';
import { useApp } from '@/store';
import { useMapState } from '@/ui/hooks/useMapState';
import { IconButton } from '@/ui/shell/IconButton';

const readBearing = (m: { getBearing(): number }) => Math.round(m.getBearing());
const readPitch = (m: { getPitch(): number }) => Math.round(m.getPitch());

/** Bottom right: tilt, Rover View, north, the landing site, and zoom. `compact` leaves zoom to the fingers. */
export function MapButtons({ compact = false }: { compact?: boolean }) {
  const bearing = useMapState(readBearing, 0);
  const pitch = useMapState(readPitch, 0);
  const tilted = pitch > 5;
  const pickingView = useApp((s) => s.picking === 'roverView');
  const setPicking = useApp((s) => s.setPicking);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="panel flex flex-col p-0.5">
        <IconButton
          label={tilted ? 'Look straight down' : 'Tilt the view'}
          active={tilted}
          onClick={() => {
            const map = getMap();
            if (map) chooseTilt(map, tilted);
          }}
        >
          <span className="figure text-[13px] font-semibold tracking-tight">{tilted ? '2D' : '3D'}</span>
        </IconButton>
        <IconButton label="Rover View: stand on the ground" active={pickingView} onClick={() => setPicking(pickingView ? null : 'roverView')}>
          <Binoculars />
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
      {compact ? null : (
        <div className="panel flex flex-col p-0.5">
          <IconButton label="Zoom in" onClick={() => getMap()?.zoomIn({ duration: 250 })}>
            <Plus />
          </IconButton>
          <div className="mx-2 h-px bg-border" aria-hidden />
          <IconButton label="Zoom out" onClick={() => getMap()?.zoomOut({ duration: 250 })}>
            <Minus />
          </IconButton>
        </div>
      )}
    </div>
  );
}
