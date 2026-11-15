import { toBitmap } from './common';
import { imgTile, liveDetailWanted, tileTouchesHirise, transparentTile } from './img';
import { mapHdTile, mapImgTile, mapQuickImgTile } from './tone';
import { demTile, dtmWanted } from './dem';

/**
 * How every map tile is put together, progressively. A tile whose full version waits on a live service
 * (CTX, HiRISE, the USGS mosaic or elevation model) is answered at once with a stand-in made from the
 * shipped package alone, marked to expire soon, while the full tile is put together in the background. When
 * it is ready, `onReady` says so and the map asks for the tile again, now answered from memory. The map is
 * never left waiting on the network with nothing to draw, and a slow tile never holds up a fast one.
 *
 * This runs in the tile workers (tile.worker.ts), and on the main thread where workers are not available.
 */
export type TileKind = 'img' | 'hd' | 'dem' | 'raw';
export type ServeMode = 'progressive' | 'full';
export type ReadyCallback = (kind: TileKind, z: number, x: number, y: number) => void;

export interface Served {
  bitmap: ImageBitmap;
  /** Seconds the map may keep this before asking again: set on a stand-in. */
  maxAge?: number;
}

/** How long a stand-in is kept before the map asks again, s: the backstop if the ready call is missed. */
const STAND_IN_AGE: Record<TileKind, number> = { img: 8, hd: 10, dem: 10, raw: 0 };
/**
 * How long a request waits for the full tile before taking the stand-in, ms. A full tile that is nearly
 * ready (its sources already in memory) is better delivered whole: it fades in, where a swapped one pops.
 */
const HOLD_MS: Record<TileKind, number> = { img: 70, hd: 260, dem: 120, raw: 0 };
/** Give up on a background tile after this long, ms; the map asks again when the stand-in expires. */
const GIVE_UP_MS: Record<TileKind, number> = { img: 30_000, hd: 90_000, dem: 90_000, raw: 60_000 };

/**
 * Finished tiles that took live sources to make, most recently used last. Only until the map has taken them:
 * the map keeps its own tiles, so this holds the few made in the background and not yet asked for again, and
 * the warm-up's. A quarter of a megabyte each, in every worker.
 */
const finals = new Map<string, ImageBitmap>();
const FINALS_MAX = 24;
/** Stand-ins, so the map's repeat requests while a tile is being made cost nothing. */
const standIns = new Map<string, ImageBitmap>();
const STAND_INS_MAX = 12;
/** Full tiles being made in the background. */
const pending = new Map<string, { promise: Promise<ImageBitmap | null>; abort: AbortController; notify: ReadyCallback | null }>();
/** Background jobs beyond this give way, oldest first: the view has moved on from them. */
const PENDING_MAX = 48;

function take(cache: Map<string, ImageBitmap>, key: string): ImageBitmap | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Evicted bitmaps are left to the garbage collector, not closed: a request may hold one it took from the cache
 * a moment ago and still be copying it.
 */
function put(cache: Map<string, ImageBitmap>, key: string, bitmap: ImageBitmap, max: number): void {
  cache.delete(key);
  cache.set(key, bitmap);
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** A copy to hand out: the receiver may close or transfer it, and the cached one must survive that. */
function copy(bitmap: ImageBitmap): Promise<ImageBitmap> {
  return createImageBitmap(bitmap);
}

async function full(kind: TileKind, z: number, x: number, y: number, signal: AbortSignal): Promise<ImageBitmap> {
  switch (kind) {
    case 'img':
      return toBitmap(await mapImgTile([], z, x, y, signal));
    case 'hd':
      return toBitmap(await mapHdTile([], z, x, y, signal));
    case 'dem':
      return toBitmap(await demTile([], z, x, y, signal));
    case 'raw':
      return toBitmap(await imgTile([], z, x, y, signal));
  }
}

/** Whether the full tile waits on a live service, so is worth keeping and worth a stand-in. */
async function slow(kind: TileKind, z: number, x: number, y: number): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  switch (kind) {
    case 'img':
    case 'raw':
      return liveDetailWanted(z, x, y);
    case 'hd':
      return tileTouchesHirise(z, x, y);
    case 'dem':
      return dtmWanted(z, x, y);
  }
}

async function standIn(kind: TileKind, z: number, x: number, y: number, signal: AbortSignal): Promise<ImageBitmap> {
  switch (kind) {
    case 'hd':
      // Clear until the mosaic arrives: the base shows through.
      return transparentTile();
    case 'dem':
      return toBitmap(await demTile([], z, x, y, signal, true));
    default:
      return toBitmap(await mapQuickImgTile([], z, x, y, signal));
  }
}

function background(key: string, kind: TileKind, z: number, x: number, y: number, onReady: ReadyCallback | null): Promise<ImageBitmap | null> {
  const running = pending.get(key);
  if (running) {
    // A job started for a warm-up may now have a map waiting on it too.
    running.notify ??= onReady;
    return running.promise;
  }
  const abort = new AbortController();
  const entry = { promise: null as unknown as Promise<ImageBitmap | null>, abort, notify: onReady };
  const timer = setTimeout(() => abort.abort(), GIVE_UP_MS[kind] || 30_000);
  const promise = full(kind, z, x, y, abort.signal)
    .then((bitmap) => {
      if (abort.signal.aborted) {
        bitmap.close();
        return null;
      }
      put(finals, key, bitmap, FINALS_MAX);
      standIns.delete(key);
      entry.notify?.(kind, z, x, y);
      return bitmap;
    })
    .catch(() => null)
    .finally(() => {
      clearTimeout(timer);
      if (pending.get(key)?.abort === abort) pending.delete(key);
    });
  entry.promise = promise;
  pending.set(key, entry);
  while (pending.size > PENDING_MAX) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.get(oldest)?.abort.abort();
    pending.delete(oldest);
  }
  return promise;
}

const delay = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/**
 * One tile. In `progressive` mode a slow tile comes back as a stand-in with `maxAge` set, and `onReady` is
 * called once the full one is in memory. In `full` mode the call waits for the full tile (warming the view
 * ahead of the camera, Rover View's ground).
 */
export async function serveTile(kind: TileKind, z: number, x: number, y: number, mode: ServeMode, signal: AbortSignal, onReady: ReadyCallback | null): Promise<Served> {
  try {
    return await serve(kind, z, x, y, mode, signal, onReady);
  } catch (err) {
    if (signal.aborted) throw err;
    // Whatever went wrong, a tile that draws sensibly: clear for the HD layer, the package's own ground and
    // heights for the rest. A flat fill here would lay an opaque sheet over the base, or a cliff in the terrain.
    if (kind === 'hd') return { bitmap: await transparentTile() };
    if (kind === 'dem') return { bitmap: await toBitmap(await demTile([], z, x, y, signal, true)) };
    return { bitmap: await toBitmap(await mapQuickImgTile([], z, x, y, signal)) };
  }
}

async function serve(kind: TileKind, z: number, x: number, y: number, mode: ServeMode, signal: AbortSignal, onReady: ReadyCallback | null): Promise<Served> {
  const key = `${kind}/${z}/${x}/${y}`;
  const done = take(finals, key);
  if (done) return { bitmap: await copy(done) };
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');

  if (!(await slow(kind, z, x, y))) return { bitmap: await full(kind, z, x, y, signal) };

  const job = background(key, kind, z, x, y, mode === 'progressive' ? onReady : null);
  if (mode === 'full') {
    const made = await Promise.race([job, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))]);
    if (made) return { bitmap: await copy(made) };
    // The live sources failed: the package's own version, as the map would draw it offline.
    return { bitmap: await full(kind, z, x, y, signal) };
  }

  const early = await Promise.race([job, delay(HOLD_MS[kind])]);
  if (early) return { bitmap: await copy(early) };
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  let stand = take(standIns, key);
  if (!stand) {
    stand = await standIn(kind, z, x, y, signal);
    // The full tile may have landed while the stand-in was made.
    const landed = take(finals, key);
    if (landed) {
      stand.close();
      return { bitmap: await copy(landed) };
    }
    put(standIns, key, stand, STAND_INS_MAX);
  }
  return { bitmap: await copy(stand), maxAge: STAND_IN_AGE[kind] };
}
