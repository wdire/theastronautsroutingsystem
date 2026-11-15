import { mapToneAmount, mapToneLut } from '@/engines/grading';
import { hdTile, imgTile } from './img';
import { toBitmap, type TileData, type TileHandler } from './index';

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

// One scratch canvas for every tile: drawing and reading back happen in one go, with no await between.
let scratch: OffscreenCanvas | null = null;

async function toned(data: TileData, lut: Uint8ClampedArray, sharpen = 0): Promise<ImageBitmap> {
  const bitmap = await toBitmap(data);
  const { width, height } = bitmap;
  if (!scratch || scratch.width !== width || scratch.height !== height) scratch = new OffscreenCanvas(width, height);
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return bitmap;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i] ?? 0] ?? 0;
    px[i + 1] = lut[px[i + 1] ?? 0] ?? 0;
    px[i + 2] = lut[px[i + 2] ?? 0] ?? 0;
  }
  if (sharpen > 0) unsharp(px, width, height, sharpen);
  return createImageBitmap(image);
}

/**
 * A light unsharp mask (the pixel less a 3x3 blur of it): the mosaics are resampled more than once on the
 * way to a tile, and each pass softens them. Edges of rock and dune crests get back the bite the orbiter saw.
 */
function unsharp(px: Uint8ClampedArray, w: number, h: number, amount: number): void {
  const src = px.slice();
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const i = o + c;
        const blur =
          ((src[i - w * 4 - 4] ?? 0) + (src[i - w * 4] ?? 0) * 2 + (src[i - w * 4 + 4] ?? 0) + (src[i - 4] ?? 0) * 2 + (src[i] ?? 0) * 4 + (src[i + 4] ?? 0) * 2 + (src[i + w * 4 - 4] ?? 0) + (src[i + w * 4] ?? 0) * 2 + (src[i + w * 4 + 4] ?? 0)) / 16;
        const v = src[i] ?? 0;
        px[i] = v + (v - blur) * amount;
      }
    }
  }
}

/**
 * The base image as the map shows it: the tile, with its shadows lifted so dark ground can be read.
 * Rover View takes the untouched tile (`imgTile`) and grades it for eye level itself.
 */
export const mapImgTile: TileHandler = async (rest, z, x, y, signal) => {
  const data = await imgTile(rest, z, x, y, signal);
  const lut = lutFor(z);
  // A tile the map has stopped waiting for is not worth toning.
  if (!lut || signal.aborted) return data;
  try {
    // From the regional view in, a light sharpening; most at the zooms the 20 m mosaic is shown at its own size.
    return await toned(data, lut, z >= 11 ? (z <= 14 ? 0.7 : 0.4) : 0);
  } catch {
    // A tile that cannot be read back is shown as it came.
    return data;
  }
};

/** The 25 cm HiRISE layer, toned like the base under it. A clear tile (nothing here) passes as it is. */
export const mapHdTile: TileHandler = async (rest, z, x, y, signal) => {
  const data = await hdTile(rest, z, x, y, signal);
  const lut = lutFor(z);
  if (!lut || signal.aborted || (data instanceof ImageBitmap && data.width === 1)) return data;
  try {
    return await toned(data, lut);
  } catch {
    return data;
  }
};
