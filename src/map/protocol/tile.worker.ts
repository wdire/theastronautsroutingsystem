/// <reference lib="webworker" />
/**
 * A tile worker: puts map tiles together off the main thread (fetching, warping, blurring, blending, toning),
 * so the map and Rover View keep their frame rate while the ground loads. See pool.ts for the other side.
 */
import { serveTile, type ServeMode, type TileKind } from './serve';

export type ToWorker = { t: 'tile'; id: number; kind: TileKind; z: number; x: number; y: number; mode: ServeMode } | { t: 'abort'; id: number };
export type FromWorker =
  | { t: 'done'; id: number; bitmap: ImageBitmap; maxAge?: number }
  | { t: 'fail'; id: number; aborted: boolean; message: string }
  | { t: 'ready'; kind: TileKind; z: number; x: number; y: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const aborts = new Map<number, AbortController>();

const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.t === 'abort') {
    aborts.get(msg.id)?.abort();
    aborts.delete(msg.id);
    return;
  }
  const abort = new AbortController();
  aborts.set(msg.id, abort);
  serveTile(msg.kind, msg.z, msg.x, msg.y, msg.mode, abort.signal, (kind, z, x, y) => post({ t: 'ready', kind, z, x, y }))
    .then((served) => post({ t: 'done', id: msg.id, bitmap: served.bitmap, ...(served.maxAge ? { maxAge: served.maxAge } : {}) }, [served.bitmap]))
    .catch((err: unknown) => post({ t: 'fail', id: msg.id, aborted: abort.signal.aborted, message: err instanceof Error ? err.message : String(err) }))
    .finally(() => aborts.delete(msg.id));
};
