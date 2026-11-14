import { MARS_RADIUS_M } from '@/lib/constants';
import { pickScale } from '@/lib/scale';
import { useMapState } from '@/ui/hooks/useMapState';

/** Metres per CSS pixel at the map centre. MapLibre's zoom 0 world is 512 px wide. */
function readScale(map: { getZoom(): number; getCenter(): { lat: number } }): number {
  return (Math.cos((map.getCenter().lat * Math.PI) / 180) * 2 * Math.PI * MARS_RADIUS_M) / (512 * 2 ** map.getZoom());
}

const closeEnough = (a: number, b: number) => Math.abs(a - b) / (b || 1) < 0.01;

export function ScaleBar() {
  const mpp = useMapState(readScale, 0, closeEnough);
  if (!(mpp > 0)) return null;
  const { px, label } = pickScale(mpp);
  return (
    <div className="pointer-events-none flex flex-col items-end gap-1 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]" aria-label={`Scale: ${label}`}>
      <span className="figure text-[11px] leading-none font-medium text-white/90">{label}</span>
      <span
        className="block h-1.5 border-x-[1.5px] border-b-[1.5px] border-white/90 shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
        style={{ width: px }}
      />
    </div>
  );
}
