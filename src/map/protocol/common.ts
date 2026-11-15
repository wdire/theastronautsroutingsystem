/**
 * What every tile module shares. Kept apart from the protocol's registration (index.ts), which pulls in the
 * map library: the tile workers import these and must not load the whole library.
 */
export type TileData = ArrayBuffer | ImageBitmap;

/** A tile with how long the map may keep it before asking again, s: set on a stand-in that a finer tile will replace. */
export interface TileResult {
  data: TileData;
  maxAge?: number;
}

export type TileHandler = (rest: string[], z: number, x: number, y: number, signal: AbortSignal) => Promise<TileData | TileResult>;

/** A tile as a bitmap, whichever way its handler delivered it. */
export function toBitmap(data: TileData): Promise<ImageBitmap> {
  return data instanceof ArrayBuffer ? createImageBitmap(new Blob([data])) : Promise.resolve(data);
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
