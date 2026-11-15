import { addProtocol, type GetResourceResponse } from 'maplibre-gl';
import { flatTile, MARS_FLAT, type TileData, type TileHandler, type TileResult } from './common';

/**
 * The mars:// tile protocol. One place decides what every map tile is made of:
 *   mars://img/{z}/{x}/{y}            base imagery
 *   mars://dem/{z}/{x}/{y}            terrarium elevation
 *   mars://derived/{kind}/{z}/{x}/{y} overlays computed from elevation
 *   mars://live/{layer}/{z}/{x}/{y}   overlays fetched from NASA and USGS services
 * Handlers are registered by kind so each can live in its own module.
 */
export { flatTile, MARS_FLAT, toBitmap, type TileData, type TileHandler, type TileResult } from './common';

const handlers = new Map<string, TileHandler>();
let registered = false;

export function setTileHandler(kind: string, handler: TileHandler): void {
  handlers.set(kind, handler);
}

export function parseTileUrl(url: string): { kind: string; rest: string[]; z: number; x: number; y: number } | null {
  const m = /^mars:\/\/([a-z]+)\/((?:[A-Za-z]+\/)*)(\d+)\/(\d+)\/(\d+)/.exec(url);
  if (!m) return null;
  return {
    kind: m[1] ?? '',
    rest: (m[2] ?? '').split('/').filter(Boolean),
    z: Number(m[3]),
    x: Number(m[4]),
    y: Number(m[5]),
  };
}

const FOREVER = 'max-age=31536000';

function isResult(v: TileData | TileResult): v is TileResult {
  return !(v instanceof ArrayBuffer) && !(typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap);
}

export function registerMarsProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('mars', async (params, abort): Promise<GetResourceResponse<TileData>> => {
    const tile = parseTileUrl(params.url);
    const handler = tile ? handlers.get(tile.kind) : undefined;
    if (!tile || !handler) return { data: await flatTile(MARS_FLAT) };
    try {
      const out = await handler(tile.rest, tile.z, tile.x, tile.y, abort.signal);
      if (isResult(out) && out.maxAge) return { data: out.data, cacheControl: `max-age=${out.maxAge}` };
      // A finished tile says it never expires: a tile the map first got as a stand-in keeps the stand-in's
      // expiry otherwise, and is asked for again and again.
      return { data: isResult(out) ? out.data : out, cacheControl: FOREVER };
    } catch (err) {
      if (abort.signal.aborted) throw err;
      // A failed tile must never leave a hole in the planet.
      return { data: await flatTile(MARS_FLAT) };
    }
  });
}
