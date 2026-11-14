import { addProtocol, type GetResourceResponse } from 'maplibre-gl';

/**
 * The mars:// tile protocol. One place decides what every map tile is made of:
 *   mars://img/{z}/{x}/{y}            base imagery
 *   mars://dem/{z}/{x}/{y}            terrarium elevation
 *   mars://derived/{kind}/{z}/{x}/{y} overlays computed from elevation
 *   mars://live/{layer}/{z}/{x}/{y}   overlays fetched from NASA and USGS services
 * Handlers are registered by kind so each can live in its own module.
 */
export type TileData = ArrayBuffer | ImageBitmap;
export type TileHandler = (rest: string[], z: number, x: number, y: number, signal: AbortSignal) => Promise<TileData>;

const handlers = new Map<string, TileHandler>();
let registered = false;

export function setTileHandler(kind: string, handler: TileHandler): void {
  handlers.set(kind, handler);
}

/** A 256 px tile of one colour, used when nothing else can be drawn. Never throws. */
export async function flatTile(rgb: readonly [number, number, number]): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
    ctx.fillRect(0, 0, 256, 256);
  }
  return canvas.transferToImageBitmap();
}

/** Mid ochre: the average colour of Mars in the Viking mosaic. */
export const MARS_FLAT: readonly [number, number, number] = [150, 96, 62];

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

export function registerMarsProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol('mars', async (params, abort): Promise<GetResourceResponse<TileData>> => {
    const tile = parseTileUrl(params.url);
    const handler = tile ? handlers.get(tile.kind) : undefined;
    if (!tile || !handler) return { data: await flatTile(MARS_FLAT) };
    try {
      return { data: await handler(tile.rest, tile.z, tile.x, tile.y, abort.signal) };
    } catch (err) {
      if (abort.signal.aborted) throw err;
      // A failed tile must never leave a hole in the planet.
      return { data: await flatTile(MARS_FLAT) };
    }
  });
}
