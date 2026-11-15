import type { Overlay } from '@/store';

/** Every overlay, as the Layers panel names it, with a line on what it is for out on the ground. */
export const OVERLAY_ITEMS: readonly { id: Overlay; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'The ground as the cameras see it.' },
  { id: 'geology', label: 'Geologic map', hint: 'Rock units and their ages (USGS).' },
  { id: 'olivine', label: 'Olivine and pyroxene', hint: 'Volcanic minerals, from CRISM.' },
  { id: 'carbonate', label: 'Carbonate', hint: 'Minerals made in water, from CRISM.' },
  { id: 'slope', label: 'Slope', hint: 'Too steep for the plan’s vehicle.' },
  { id: 'night', label: 'Rock or dust', hint: 'Night warmth, from THEMIS: soft ground is dark.' },
  { id: 'elevation', label: 'Elevation', hint: 'Height in colour, from MOLA.' },
];

/** The overlay's name, for the tablet's caption; empty for none. */
export const OVERLAY_NAMES: Record<Overlay, string> = Object.fromEntries(OVERLAY_ITEMS.map((i) => [i.id, i.id === 'none' ? '' : i.label])) as Record<Overlay, string>;

