/**
 * How much the map’s relief is exaggerated at each zoom. A 45 km crater that is 500 m deep reads
 * as flat at true scale, so mid zooms are stretched; the chip on the map always says by how much.
 */
const STOPS: readonly (readonly [zoom: number, factor: number])[] = [
  [6, 1],
  [8, 2.2],
  [9.5, 3],
  [11.5, 3],
  [13, 2.2],
  [15, 1.8],
  // Close in the HiRISE model's own metres draw the ground; a modest stretch keeps benches, ridges and
  // crater walls standing up as a person on the ground would feel them, instead of a flat sheet.
  [16.5, 1.5],
  [18, 1.4],
];

export function reliefExaggeration(zoom: number): number {
  const first = STOPS[0];
  const last = STOPS[STOPS.length - 1];
  if (!first || !last) return 1;
  if (!(zoom > first[0])) return first[1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < STOPS.length; i += 1) {
    const a = STOPS[i - 1];
    const b = STOPS[i];
    if (a && b && zoom <= b[0]) return a[1] + ((b[1] - a[1]) * (zoom - a[0])) / (b[0] - a[0]);
  }
  return last[1];
}

/** "Relief x3.0 exaggerated", or "Relief at true scale" when it is not. */
export function reliefLabel(factor: number): string {
  if (Math.abs(factor - 1) < 0.05) return 'Relief at true scale';
  // On the tallest volcanoes the stretch is held back to keep the ground under the camera.
  return factor < 1 ? `Relief x${factor.toFixed(1)}, flattened` : `Relief x${factor.toFixed(1)} exaggerated`;
}
