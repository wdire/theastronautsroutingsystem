import { getCoverage, loadCoverage, nearestTile } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { encodeTerrarium, TILE } from '@/data/terrarium';
import type { TileData } from './index';
/** The map's terrain stops at the package's zoom 14 (HiRISE read at 5 m); MapLibre stretches it beyond. */
export const MAP_DEM_MAX_ZOOM = 14;

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
  void signal;
  return terrariumBitmap((await tileHeights(z, x, y)).heights);
}
