/**
 * Loads the ground a moving view is about to reach, before it gets there: the elevation package and the
 * HiRISE model and image under the route ahead, at low priority so the ground underfoot always comes first.
 * Every tile lands in the same caches the ground layers read, so the next patch builds from memory.
 */
import { groundAt } from '@/data/dem';
import { boxTouchesHirise, warmEsriHirise, warmHirise } from '@/data/hirise';
import { distanceM } from '@/lib/geo';

const M_PER_DEG = 59_270;
const asked = new Set<string>();

function box(lon: number, lat: number, halfM: number): [number, number, number, number] {
  const dLat = halfM / M_PER_DEG;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/**
 * Asks for the ground at a few points along `path` (lon, lat; nearest first): the coarse layers always, the
 * close 25 cm ground only when the view moves slowly enough to see it.
 */
export function prefetchAhead(path: readonly (readonly [number, number])[], fast: boolean, coarseOnly = false): void {
  const first = path[0];
  if (!first) return;
  const marks = fast ? [600, 1400, 2400] : [250, 600, 1100];
  let along = 0;
  let k = 0;
  for (let i = 1; i < path.length && k < marks.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    along += distanceM(a[0], a[1], b[0], b[1]);
    if (along < marks[k]!) continue;
    k += 1;
    const [lon, lat] = b;
    // One request per 150 m cell and kind: a replay at speed passes the same cell many frames in a row.
    const cell = `${Math.round(lon * 400)},${Math.round(lat * 400)}`;
    if (!asked.has(`p${cell}`)) {
      asked.add(`p${cell}`);
      void groundAt(lon, lat).catch(() => undefined);
    }
    const near = box(lon, lat, 1000);
    if (coarseOnly || !boxTouchesHirise(...near)) continue;
    if (!asked.has(`n${cell}`)) {
      asked.add(`n${cell}`);
      // Tiles only: the mosaic is put together when the patch is built, from memory or the browser's cache.
      warmHirise('dtm', near, 2, 9);
      warmEsriHirise(near, 14);
    }
    if (!fast && !asked.has(`c${cell}`)) {
      asked.add(`c${cell}`);
      const close = box(lon, lat, 128);
      warmHirise('dtm', close, 0, 8);
      warmHirise('ortho', close, 0, 9);
    }
  }
  if (asked.size > 4000) asked.clear();
}
