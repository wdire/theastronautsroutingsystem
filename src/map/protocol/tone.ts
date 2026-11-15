import { mapToneAmount, mapToneLut } from '@/engines/grading';
import { hdTile, imgTile, packageImage } from './img';
import { toBitmap, type TileData } from './common';
import { pxToLat } from '@/lib/geo';

type TileHandler = (rest: string[], z: number, x: number, y: number, signal: AbortSignal) => Promise<TileData>;

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

/** From the regional view in, a light sharpening; most at the zooms the 20 m mosaic is shown at its own size. */
function sharpenFor(z: number): number {
  return z >= 11 ? (z <= 14 ? 0.7 : 0.4) : 0;
}

/** A tile toned for the map at its zoom; as it came if it cannot be read back. */
async function forMap(data: TileData, z: number, sharpen: number, signal: AbortSignal): Promise<TileData> {
  const lut = lutFor(z);
  // A tile the map has stopped waiting for is not worth toning.
  if (!lut || signal.aborted) return data;
  try {
    return await toned(data, lut, sharpen);
  } catch {
    return data;
  }
}

/**
 * The colour of each polar cap as the globe closes it: the ice of the residual caps, a little dimmed by the
 * dust on it, so the closed pole reads as the bright cap the mosaic shows around it.
 */
const CAP_NORTH: readonly [number, number, number] = [196, 181, 171];
const CAP_SOUTH: readonly [number, number, number] = [188, 168, 150];
/** Latitudes over which the imagery gives way to the cap colour, degrees. */
const CAP_FROM = 81.5;
const CAP_TO = 84.9;

/**
 * Web Mercator ends at 85.05 degrees; the globe closes each pole by stretching the tiles' last row of pixels
 * to a point, so every bright or dark pixel in that row became a spoke of a pinched fan. Toward the pole the
 * imagery is blended into one colour per cap, so the stretched row is even and the cap reads as a cap.
 */
async function polarCap(data: TileData, z: number, y: number): Promise<TileData> {
  const top = Math.abs(pxToLat(y * 256, z));
  const bottom = Math.abs(pxToLat((y + 1) * 256, z));
  if (Math.max(top, bottom) < CAP_FROM) return data;
  const bitmap = await toBitmap(data);
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0, 256, 256);
  bitmap.close();
  const image = ctx.getImageData(0, 0, 256, 256);
  const px = image.data;
  for (let row = 0; row < 256; row += 1) {
    const lat = pxToLat(y * 256 + row + 0.5, z);
    const t = Math.max(0, Math.min(1, (Math.abs(lat) - CAP_FROM) / (CAP_TO - CAP_FROM)));
    const w = t * t * (3 - 2 * t);
    if (w <= 0) continue;
    const cap = lat > 0 ? CAP_NORTH : CAP_SOUTH;
    for (let i = row * 256 * 4; i < (row + 1) * 256 * 4; i += 4) {
      px[i] = (px[i] ?? 0) + (cap[0] - (px[i] ?? 0)) * w;
      px[i + 1] = (px[i + 1] ?? 0) + (cap[1] - (px[i + 1] ?? 0)) * w;
      px[i + 2] = (px[i + 2] ?? 0) + (cap[2] - (px[i + 2] ?? 0)) * w;
    }
  }
  return createImageBitmap(image);
}

/**
 * The base image as the map shows it: the tile, with its shadows lifted so dark ground can be read.
 * Rover View takes the untouched tile (`imgTile`) and grades it for eye level itself.
 */
export const mapImgTile: TileHandler = async (rest, z, x, y, signal) => forMap(await polarCap(await imgTile(rest, z, x, y, signal), z, y), z, sharpenFor(z), signal);

/** The base image from the package alone, toned the same: what stands in while the live detail is fetched. */
export const mapQuickImgTile: TileHandler = async (_rest, z, x, y, signal) => forMap(await polarCap(await packageImage(z, x, y, signal), z, y), z, sharpenFor(z), signal);


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
