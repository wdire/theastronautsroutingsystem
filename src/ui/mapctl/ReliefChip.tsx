import { useEffect, useState } from 'react';
import { reliefLabel } from '@/engines/relief';
import { getExaggeration, onExaggeration } from '@/map/terrain';

/** Says how much the relief is stretched. Every exaggeration in the app is labelled. */
export function ReliefChip() {
  const [factor, setFactor] = useState(getExaggeration);
  useEffect(() => onExaggeration(setFactor), []);
  return (
    <span className="figure pointer-events-none text-[11.5px] leading-none font-medium whitespace-nowrap text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.95),0_0_1px_rgb(0_0_0/0.8)]">
      {reliefLabel(factor)}
    </span>
  );
}
