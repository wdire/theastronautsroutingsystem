import { getCoverage, loadCoverage, nearestTile } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { encodeTerrarium, TILE } from '@/data/terrarium';
import type { TileData } from './index';
import { loadHiriseHeights } from '@/data/hirise';
import { pxToLat, pxToLon } from '@/lib/geo';
import { tileTouchesHirise } from './img';

/** The map's terrain reaches zoom 16 over Jezero's HiRISE model (about 1.2 m a pixel); the package stops at 14. */
export const MAP_DEM_MAX_ZOOM = 16;

/**
 * HiRISE's own 1 m model over a map tile, levelled onto the package heights (the median difference is
 * added), with the package filling whatever the model does not cover. Null if the model is not there.
 */
async function hiriseHeights(z: number, x: number, y: number, base: Float32Array, signal: AbortSignal): Promise<Float32Array | null> {
  const box = [pxToLon(x * TILE, z), pxToLat((y + 1) * TILE, z), pxToLon((x + 1) * TILE, z), pxToLat(y * TILE, z)] as const;
  const model = await loadHiriseHeights(box, z >= 16 ? 0 : 1, signal).catch(() => null);
  if (!model || model.filled === 0) return null;
  const out = new Float32Array(TILE * TILE);
  const found = new Float32Array(TILE * TILE).fill(Number.NaN);
  const diffs: number[] = [];
  for (let j = 0; j < TILE; j += 1) {
    const lat = pxToLat(y * TILE + j + 0.5, z);
    for (let i = 0; i < TILE; i += 1) {
      const h = model.heightAt(pxToLon(x * TILE + i + 0.5, z), lat);
      if (h === null) continue;
      found[j * TILE + i] = h;
      if ((i & 7) === 0 && (j & 7) === 0) diffs.push((base[j * TILE + i] ?? 0) - h);
    }
  }
  if (diffs.length === 0) return null;
  diffs.sort((a, b) => a - b);
  const offset = diffs[diffs.length >> 1] ?? 0;
  for (let k = 0; k < out.length; k += 1) {
    const h = found[k] ?? Number.NaN;
    out[k] = Number.isFinite(h) ? h + offset : (base[k] ?? 0);
  }
  return out;
}

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
  if (z >= 15 && tileTouchesHirise(z, x, y)) {
    const fine = await hiriseHeights(z, x, y, base, signal);
    if (fine) return terrariumBitmap(fine);
  }
  return terrariumBitmap(base);
}
