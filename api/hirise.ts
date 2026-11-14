import { HIRISE_LAYERS, HIRISE_TILE, isHiriseLayer, tileSourceWindow, type HiriseLayer } from '../src/data/hiriseGrid';

/**
 * GET /api/hirise?layer=ortho|dtm&l=<level>&x=<col>&y=<row>: one 512 px tile cut from the Mars 2020
 * HiRISE mosaics of Jezero (USGS Astrogeology, Fergason et al. 2020), read straight from USGS by HTTP
 * ranges. The GeoTIFFs are uncompressed with one row per strip, so every output row is one small range.
 *
 * Level l: one output pixel is 2^l source pixels. Rows are sampled at the centre of each band of
 * 2^l rows; columns are averaged. ortho answers a grey and alpha PNG (alpha 0 where there is no image),
 * dtm a Terrarium PNG (height = R * 256 + G + B / 256 - 32768, alpha 0 where there is no model).
 * The source never changes, so tiles are cached for a year.
 */

interface Strips {
  /** Byte offset of row 0. Rows follow each other with no gap. */
  first: number;
}

const strips = new Map<HiriseLayer, Promise<Strips>>();

/** Ranges in flight across every tile this instance is cutting: enough to fill the pipe, not to flood it. */
const MAX_IN_FLIGHT = 256;
let inFlight = 0;
const queue: (() => void)[] = [];

async function range(url: string, from: number, to: number, signal: AbortSignal): Promise<Uint8Array> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => queue.push(resolve));
  inFlight += 1;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal });
        if (res.status !== 206) throw new Error(`USGS answered ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        if (attempt >= 2 || signal.aborted) throw err;
      }
    }
  } finally {
    inFlight -= 1;
    queue.shift()?.();
  }
}

/** Finds where row 0 starts, and checks the rows are packed one after another as the tile maths assumes. */
function readStrips(layer: HiriseLayer, signal: AbortSignal): Promise<Strips> {
  let hit = strips.get(layer);
  if (!hit) {
    const spec = HIRISE_LAYERS[layer];
    hit = (async () => {
      const rowBytes = spec.width * spec.bytes;
      const lastEntry = spec.offsetTable + (spec.height - 1) * spec.offsetBytes;
      const [head, tail] = await Promise.all([
        range(spec.url, spec.offsetTable, spec.offsetTable + spec.offsetBytes - 1, signal),
        range(spec.url, lastEntry, lastEntry + spec.offsetBytes - 1, signal),
      ]);
      const read = (b: Uint8Array) => {
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return spec.offsetBytes === 8 ? Number(v.getBigUint64(0, true)) : v.getUint32(0, true);
      };
      const first = read(head);
      if (read(tail) !== first + (spec.height - 1) * rowBytes) throw new Error(`${layer}: rows are not packed`);
      return { first };
    })();
    hit.catch(() => strips.delete(layer));
    strips.set(layer, hit);
  }
  return hit;
}

async function pool(count: number, width: number, job: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, count) }, async () => {
      while (next < count) {
        const i = next;
        next += 1;
        await job(i);
      }
    }),
  );
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i += 1) c = (CRC_TABLE[(c ^ (p[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PNG of 8-bit samples: colour type 4 (grey, alpha) or 6 (RGBA). Rows get filter 1 (sub), which suits imagery. */
async function png(width: number, height: number, channels: 2 | 4, pixels: Uint8Array): Promise<Uint8Array> {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let i = 0; i < stride; i += 1) {
      const v = pixels[y * stride + i] ?? 0;
      const left = i >= channels ? (pixels[y * stride + i - channels] ?? 0) : 0;
      raw[o + 1 + i] = (v - left) & 0xff;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    const name = new TextEncoder().encode(type);
    out.set(name, 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32([name, data]));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 2 ? 4 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function answer(body: BodyInit | null, status: number, cache: string, type = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': type, 'cache-control': cache, 'access-control-allow-origin': '*' } });
}

const MAX_TILES = 3;
let cutting = 0;
const waitingTiles: (() => void)[] = [];

const YEAR = 'public, max-age=31536000, s-maxage=31536000, immutable';

export async function cutTile(layer: HiriseLayer, level: number, tx: number, ty: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const spec = HIRISE_LAYERS[layer];
  const win = tileSourceWindow(layer, level, tx, ty);
  if (!win) return null;
  const { first } = await readStrips(layer, signal);
  const step = 2 ** level;
  const n = HIRISE_TILE;
  const rowBytes = spec.width * spec.bytes;
  const channels = layer === 'ortho' ? 2 : 4;
  const out = new Uint8Array(n * n * channels);
  let any = false;
  await pool(n, 128, async (r) => {
    const srcRow = win.row0 + r * step + (step >> 1);
    if (srcRow >= spec.height) return;
    const c0 = win.col0;
    const c1 = Math.min(spec.width, win.col0 + n * step);
    const from = first + srcRow * rowBytes + c0 * spec.bytes;
    const bytes = await range(spec.url, from, from + (c1 - c0) * spec.bytes - 1, signal);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cols = Math.ceil((c1 - c0) / step);
    for (let c = 0; c < cols; c += 1) {
      let sum = 0;
      let count = 0;
      for (let k = c * step; k < Math.min(c1 - c0, (c + 1) * step); k += 1) {
        if (layer === 'ortho') {
          const v = bytes[k] ?? 0;
          if (v > 0) {
            sum += v;
            count += 1;
          }
        } else {
          const v = view.getFloat32(k * 4, true);
          if (v > -1e5 && v < 1e5) {
            sum += v;
            count += 1;
          }
        }
      }
      if (count === 0) continue;
      any = true;
      const p = (r * n + c) * channels;
      if (layer === 'ortho') {
        out[p] = Math.round(sum / count);
        out[p + 1] = 255;
      } else {
        const h = Math.max(0, Math.min(65535.996, sum / count + 32768));
        const whole = Math.floor(h);
        out[p] = whole >> 8;
        out[p + 1] = whole & 255;
        out[p + 2] = Math.floor((h - whole) * 256);
        out[p + 3] = 255;
      }
    }
  });
  return any ? png(n, n, channels, out) : null;
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const layer = q.get('layer') ?? '';
  const level = Number(q.get('l'));
  const tx = Number(q.get('x'));
  const ty = Number(q.get('y'));
  if (!isHiriseLayer(layer) || ![level, tx, ty].every(Number.isInteger) || level < 0 || level > HIRISE_LAYERS[layer].maxLevel || tx < 0 || ty < 0) {
    return answer('layer must be ortho or dtm; l, x and y whole numbers in range', 400, 'no-store');
  }
  // Tiles are cut a few at a time, each with the whole pipe, so the first asked is the first done; the
  // clock for giving up starts when its turn comes.
  if (cutting >= MAX_TILES) await new Promise<void>((resolve) => waitingTiles.push(resolve));
  cutting += 1;
  // Whoever asked may have gone (the view moved on): then the tile is not cut at all.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
  if (signal.aborted) {
    cutting -= 1;
    waitingTiles.shift()?.();
    return answer(null, 499, 'no-store');
  }
  try {
    const tile = await cutTile(layer, level, tx, ty, signal);
    // Outside the mosaic, or wholly in its empty corners: say so, and let that be cached too.
    if (!tile) return answer(null, 204, YEAR);
    return answer(tile as BodyInit, 200, YEAR, 'image/png');
  } catch {
    return answer('USGS did not answer in time', 502, 'no-store');
  } finally {
    cutting -= 1;
    waitingTiles.shift()?.();
  }
}


