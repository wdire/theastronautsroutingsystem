import { useEffect, useState } from 'react';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { whenMapReady } from '@/map/instance';
import { fmtLatLon } from '@/lib/format';
import { sampleReadout, type Readout } from '@/map/readout';

export function CursorReadout() {
  const [value, setValue] = useState<Readout | null>(null);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    let raf = 0;
    let latest: { lng: number; lat: number } | null = null;
    const flush = () => {
      raf = 0;
      if (!latest) return setValue(null);
      setValue({ lon: latest.lng, lat: latest.lat, extra: sampleReadout(latest.lng, latest.lat) });
    };
    const onMove = (e: MapMouseEvent) => {
      latest = e.lngLat;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onOut = () => {
      latest = null;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    whenMapReady((m) => {
      if (cancelled) return;
      map = m;
      m.on('mousemove', onMove);
      m.on('mouseout', onOut);
    });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      map?.off('mousemove', onMove);
      map?.off('mouseout', onOut);
    };
  }, []);

  if (!value) return null;
  return (
    <div
      className="figure pointer-events-none flex items-center gap-3 text-[11.5px] leading-none font-medium whitespace-nowrap text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.95),0_0_1px_rgb(0_0_0/0.8)]"
      aria-hidden
      data-testid="cursor-readout"
    >
      <span>{fmtLatLon(value.lat, value.lon)}</span>
      {value.extra.map((text) => (
        <span key={text}>{text}</span>
      ))}
    </div>
  );
}
