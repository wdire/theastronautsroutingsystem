import { getCoverage, loadCoverage, nearestTile, tileUrl } from '@/data/coverage';
import { tileHeights } from '@/data/dem';
import { encodeTerrarium, TILE } from '@/data/terrarium';
import type { TileData } from './index';

function terrariumBitmap(heights: Float32Array): Promise<ImageBitmap> {
  const rgba = new Uint8ClampedArray(TILE * TILE * 4);
  encodeTerrarium(heights, rgba);
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
  if (ref.z === z) {
    const res = await fetch(tileUrl(cov, ref), { signal });
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return res.arrayBuffer();
  }
  return terrariumBitmap((await tileHeights(z, x, y)).heights);
}
