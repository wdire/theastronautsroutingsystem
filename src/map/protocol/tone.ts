import { mapToneAmount, mapToneLut } from '@/engines/grading';
import { imgTile } from './img';
import type { TileData, TileHandler } from './index';

const luts = new Map<number, Uint8ClampedArray>();

function lutFor(zoom: number): Uint8ClampedArray | null {
  const amount = mapToneAmount(zoom);
  if (amount <= 0) return null;
  const key = Math.round(amount * 100);
  let lut = luts.get(key);
  if (!lut) {
    lut = mapToneLut(amount);
    luts.set(key, lut);
  }
  return lut;
}

async function toned(data: TileData, lut: Uint8ClampedArray): Promise<ImageBitmap> {
  const bitmap = data instanceof ArrayBuffer ? await createImageBitmap(new Blob([data])) : data;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i] ?? 0] ?? 0;
    px[i + 1] = lut[px[i + 1] ?? 0] ?? 0;
    px[i + 2] = lut[px[i + 2] ?? 0] ?? 0;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.transferToImageBitmap();
}

/**
 * The base image as the map shows it: the tile, with its shadows lifted so dark ground can be read.
 * Rover View takes the untouched tile (`imgTile`) and grades it for eye level itself.
 */
export const mapImgTile: TileHandler = async (rest, z, x, y, signal) => {
  const data = await imgTile(rest, z, x, y, signal);
  const lut = lutFor(z);
  if (!lut) return data;
  try {
    return await toned(data, lut);
  } catch {
    // A tile that cannot be read back is shown as it came.
    return data;
  }
};
