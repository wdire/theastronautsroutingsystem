import { serveTile, type Served, type ServeMode, type TileKind } from './serve';
import type { FromWorker, ToWorker } from './tile.worker';

/**
 * The tile workers, seen from the main thread. Every map tile and Rover View's orbital ground are made in a
 * small pool of workers (tile.worker.ts) instead of on the main thread, where warping and blending a tile
 * cost a frame or more each. Without workers the same code runs here.
 *
 * Tiles are spread over the workers by area, so neighbours land on the same worker and share the source
 * tiles it has in memory. The 25 cm mosaic and the HiRISE elevation model go to the first worker alone: their
 * requests to the app's own server are limited there, and must not be multiplied by the number of workers.
 */
interface Call {
  resolve: (s: Served) => void;
  reject: (err: unknown) => void;
  worker: number;
  msg: Extract<ToWorker, { t: 'tile' }>;
  signal: AbortSignal;
}

let workers: (Worker | null)[] | null = null;
const calls = new Map<number, Call>();
let nextId = 1;
const readyListeners = new Set<(kind: TileKind, z: number, x: number, y: number) => void>();

/** Counts for the checks: stand-ins handed out and full tiles that replaced them, and when the last one did. */
const stats = { standIns: 0, ready: 0, lastReadyMs: 0 };
declare global {
  interface Window {
    __areoTiles?: typeof stats;
  }
}
if (typeof window !== 'undefined') window.__areoTiles = stats;

function notifyReady(kind: TileKind, z: number, x: number, y: number): void {
  stats.ready += 1;
  stats.lastReadyMs = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const cb of readyListeners) cb(kind, z, x, y);
}

function counted(served: Served): Served {
  if (served.maxAge) stats.standIns += 1;
  return served;
}

/** Called when a tile handed out as a stand-in has its full version ready: the map should ask for it again. */
export function onTileReady(cb: (kind: TileKind, z: number, x: number, y: number) => void): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

function runHere(kind: TileKind, z: number, x: number, y: number, mode: ServeMode, signal: AbortSignal): Promise<Served> {
  return serveTile(kind, z, x, y, mode, signal, notifyReady);
}

function startWorkers(): (Worker | null)[] {
  if (workers) return workers;
  workers = [];
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return workers;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // The map library runs workers of its own, and the main thread needs a core. Two are enough to keep up with
  // the network, and each keeps caches of its own: more workers only multiplied the memory.
  const count = cores >= 4 ? 2 : 1;
  for (let i = 0; i < count; i += 1) {
    try {
      const w = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module', name: `tiles-${i}` });
      w.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
      w.onerror = () => failWorker(i);
      workers.push(w);
    } catch {
      workers.push(null);
    }
  }
  return workers;
}

function onMessage(msg: FromWorker): void {
  if (msg.t === 'ready') {
    notifyReady(msg.kind, msg.z, msg.x, msg.y);
    return;
  }
  const call = calls.get(msg.id);
  if (!call) {
    if (msg.t === 'done') msg.bitmap.close();
    return;
  }
  calls.delete(msg.id);
  if (msg.t === 'done') call.resolve(msg.maxAge ? { bitmap: msg.bitmap, maxAge: msg.maxAge } : { bitmap: msg.bitmap });
  else call.reject(msg.aborted ? new DOMException('aborted', 'AbortError') : new Error(msg.message));
}

/** A worker that failed hands its open calls to the main thread, and gets no more. */
function failWorker(i: number): void {
  if (!workers) return;
  workers[i]?.terminate();
  workers[i] = null;
  for (const [id, call] of calls) {
    if (call.worker !== i) continue;
    calls.delete(id);
    const { kind, z, x, y, mode } = call.msg;
    runHere(kind, z, x, y, mode, call.signal).then(call.resolve, call.reject);
  }
}

function workerFor(kind: TileKind, z: number, x: number, y: number, pool: (Worker | null)[]): number {
  if (kind === 'hd' || (kind === 'dem' && z > 14)) return 0;
  // Blocks of tiles share a worker: 4 x 4, or 8 x 8 close in, where one HiRISE source tile spans that many.
  const shift = z >= 16 ? 3 : 2;
  const bx = x >> shift;
  const by = y >> shift;
  const h = (Math.imul(bx, 73856093) ^ Math.imul(by, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
  return h % pool.length;
}

/** One tile, made in a worker. See serveTile for the modes. Rejects with an AbortError when aborted. */
export function poolTile(kind: TileKind, z: number, x: number, y: number, mode: ServeMode, signal: AbortSignal): Promise<Served> {
  const pool = startWorkers();
  const index = pool.length > 0 ? workerFor(kind, z, x, y, pool) : -1;
  const worker = index >= 0 ? pool[index] : null;
  if (!worker) return runHere(kind, z, x, y, mode, signal).then(counted);
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  const id = nextId++;
  const msg: Extract<ToWorker, { t: 'tile' }> = { t: 'tile', id, kind, z, x, y, mode };
  return new Promise<Served>((resolve, reject) => {
    calls.set(id, { resolve: (served) => resolve(counted(served)), reject, worker: index, msg, signal });
    signal.addEventListener(
      'abort',
      () => {
        if (!calls.has(id)) return;
        calls.delete(id);
        worker.postMessage({ t: 'abort', id } satisfies ToWorker);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
    worker.postMessage(msg);
  });
}
