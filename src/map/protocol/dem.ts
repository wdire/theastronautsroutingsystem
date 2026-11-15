import { getCoverage, loadCoverage, nearestTile } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { encodeTerrarium, TILE } from '@/data/terrarium';
import { boxTouchesHirise, loadHiriseHeights } from '@/data/hirise';
import { pxToLat, pxToLon } from '@/lib/geo';
import type { TileData } from './index';
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
export async function demTile(_rest: string[], z: number, x: number, y: number, signal: AbortSignal): Promise<TileData> {
  const cov = getCoverage() ?? (await loadCoverage());
  if (!cov) return terrariumBitmap(new Float32Array(TILE * TILE));
  const ref = nearestTile(cov, ['terrain', 'planetTerrain'], z, x, y);
  if (!ref) return terrariumBitmap(new Float32Array(TILE * TILE));
  const base = (await tileHeights(z, x, y)).heights;
  if (z <= 14) return terrariumBitmap(base);
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
