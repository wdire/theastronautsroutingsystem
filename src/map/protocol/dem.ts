import { getCoverage, loadCoverage, nearestTile } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { encodeTerrarium, TILE } from '@/data/terrarium';
import { boxTouchesHirise, loadHiriseHeights } from '@/data/hirise';
import { pxToLat, pxToLon } from '@/lib/geo';
import type { TileData } from './common';
/**
 * The map's terrain goes to zoom 16: the package to 14 (HiRISE read at 5 m), then over Jezero the HiRISE model
 * itself at 4 m and 2 m, so the delta's scarps and the rim's benches stand up close in. MapLibre stretches 16.
 */
export const MAP_DEM_MAX_ZOOM = 16;

/**
 * Added to every height the map's terrain draws, m. Mars's datum sits far above Jezero (its floor is
 * 2.5 km below it), and with terrain on, MapLibre's globe camera lost the ground altogether when close
 * in and tilted. Lifting the whole planet by the same amount changes no slope and no relief; nothing
 * reads heights back from the map (they come from src/data/dem).
 */
export const MAP_DATUM_LIFT_M = 2600;

function terrariumBitmap(heights: Float32Array): Promise<ImageBitmap> {
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  const lifted = new Float32Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) lifted[i] = (heights[i] ?? 0) + MAP_DATUM_LIFT_M;
  encodeTerrarium(lifted, rgba);
  return createImageBitmap(new ImageData(rgba, TILE, TILE), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/**
 * Elevation tiles for the map’s terrain and hillshade. Where the package has no tile at this zoom,
 * the nearest ancestor is blended up, so relief never drops to a flat sheet at a coverage edge.
 */
/** The height of each polar cap as the globe closes it, m: the mean of the elevation mosaic's last row there. */
const CAP_NORTH_M = -3600;
const CAP_SOUTH_M = 2950;

/**
 * Toward each pole the heights level off to one value, as the imagery does to one colour (see tone.ts): the
 * globe closes the pole by stretching the last row to a point, and every bump in that row became a ridge of a
 * pinched fan in the relief and its shading. A copy when anything changes; the cached heights are untouched.
 */
function polarCapHeights(heights: Float32Array, z: number, y: number): Float32Array {
  const from = 81.5;
  const to = 84.9;
  if (Math.max(Math.abs(pxToLat(y * TILE, z)), Math.abs(pxToLat((y + 1) * TILE, z))) < from) return heights;
  const out = heights.slice();
  for (let row = 0; row < TILE; row += 1) {
    const lat = pxToLat(y * TILE + row + 0.5, z);
    const t = Math.max(0, Math.min(1, (Math.abs(lat) - from) / (to - from)));
    const w = t * t * (3 - 2 * t);
    if (w <= 0) continue;
    const cap = lat > 0 ? CAP_NORTH_M : CAP_SOUTH_M;
    for (let i = row * TILE; i < (row + 1) * TILE; i += 1) out[i] = (out[i] ?? 0) + (cap - (out[i] ?? 0)) * w;
  }
  return out;
}

/** Whether the full elevation tile waits on the HiRISE model (zoom 15 and 16 over Jezero). */
export function dtmWanted(z: number, x: number, y: number): boolean {
  if (z <= 14 || z > MAP_DEM_MAX_ZOOM) return false;
  return boxTouchesHirise(pxToLon(x * TILE, z), pxToLat((y + 1) * TILE, z), pxToLon((x + 1) * TILE, z), pxToLat(y * TILE, z));
}

/** With `packageOnly`, past zoom 14 the package's heights are stretched and the HiRISE model is not waited for. */
export async function demTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal, packageOnly = false): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return terrariumBitmap(new Float32Array(TILE * TILE));
  const ref = nearestTile(cov, ['terrain', 'planetTerrain'], z, x, y);
  if (!ref) return terrariumBitmap(new Float32Array(TILE * TILE));
  const base = polarCapHeights((await tileHeights(z, x, y)).heights, z, y);
  if (z <= 14 || packageOnly) return terrariumBitmap(base);
  // Past the package: the HiRISE model where it covers the tile, the package's heights stretched elsewhere.
  const west = pxToLon(x * TILE, z);
  const east = pxToLon((x + 1) * TILE, z);
  const north = pxToLat(y * TILE, z);
  const south = pxToLat((y + 1) * TILE, z);
  if (!boxTouchesHirise(west, south, east, north)) return terrariumBitmap(base);
  try {
    const model = await loadHiriseHeights([west, south, east, north], z >= 16 ? 1 : 2, signal, 6);
    const hi = new Float32Array(TILE * TILE).fill(Number.NaN);
    // The model's heights sit on its own reference surface; the package's on another, some metres apart. Where
    // the model ends the two would meet in a cliff: the model is moved onto the package by their mean difference.
    let diff = 0;
    let n = 0;
    for (let j = 0; j < TILE; j += 1) {
      const lat = pxToLat(y * TILE + j + 0.5, z);
      for (let i = 0; i < TILE; i += 1) {
        const h = model.heightAt(pxToLon(x * TILE + i + 0.5, z), lat);
        if (h === null || !Number.isFinite(h)) continue;
        hi[j * TILE + i] = h;
        diff += h - (base[j * TILE + i] ?? h);
        n += 1;
      }
    }
    if (n === 0) return terrariumBitmap(base);
    const offset = diff / n;
    const out = new Float32Array(base);
    for (let k = 0; k < out.length; k += 1) {
      const h = hi[k] ?? Number.NaN;
      if (Number.isFinite(h)) out[k] = h - offset;
    }
    return terrariumBitmap(out);
  } catch {
    return terrariumBitmap(base);
  }
}
