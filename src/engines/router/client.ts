/**
 * The main-thread side of the router: posts requests to the worker and hands back promises.
 *
 * A request is known by its id and style together, so the three styles of one plan can share an id.
 * Replies to requests that are no longer waiting (cancelled, or answered already) are dropped.
 */
import type { GridSpec } from '../terrain';
import type { RouteReply, RouteRequest } from '../types';
import type { RouterInbound, RouterOutbound } from './worker';

/** What a route() promise rejects with when its request is cancelled or the router is disposed. */
export class RouteCancelledError extends Error {
  readonly requestId: number;

  constructor(requestId: number) {
    super(`Route request ${requestId} was cancelled.`);
    this.name = 'RouteCancelledError';
    this.requestId = requestId;
  }
}

export interface Router {
  /**
   * Route a request on a grid. Resolves with the reply, which may be a typed failure (see
   * RouteReply). Rejects with RouteCancelledError if cancelled, or with an Error if the worker breaks.
   * The grid is copied to the worker; the caller keeps its heights.
   */
  route(request: RouteRequest, grid: GridSpec, onProgress?: (fraction: number) => void): Promise<RouteReply>;
  /** Stop every request with this id, waiting or running. Their promises reject. */
  cancel(requestId: number): void;
  /** Stop the worker. Waiting promises reject; the router cannot be used again. */
  dispose(): void;
}

interface Waiting {
  requestId: number;
  resolve(reply: RouteReply): void;
  reject(error: Error): void;
  onProgress?: (fraction: number) => void;
}

export function createRouter(): Router {
  let worker: Worker | null = null;
  let disposed = false;
  const waiting = new Map<string, Waiting>();
  const keyOf = (requestId: number, style: string): string => `${requestId}:${style}`;

  const rejectAll = (make: (w: Waiting) => Error): void => {
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) w.reject(make(w));
  };

  const start = (): Worker => {
    if (worker) return worker;
    const made = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    made.onmessage = (event: MessageEvent<RouterOutbound>) => {
      const message = event.data;
      if (message.type === 'progress') {
        waiting.get(keyOf(message.requestId, message.style))?.onProgress?.(message.fraction);
        return;
      }
      const key = keyOf(message.reply.requestId, message.reply.style);
      const w = waiting.get(key);
      if (!w) return; // Stale: cancelled or already answered.
      waiting.delete(key);
      w.resolve(message.reply);
    };
    made.onerror = (event: ErrorEvent) => {
      // The worker is in an unknown state: fail what is waiting and start a fresh one next time.
      made.terminate();
      if (worker === made) worker = null;
      rejectAll(() => new Error(`The route planner stopped: ${event.message || 'unknown error'}`));
    };
    worker = made;
    return made;
  };

  const post = (message: RouterInbound): void => {
    start().postMessage(message);
  };

  return {
    route(request, grid, onProgress) {
      if (disposed) return Promise.reject(new RouteCancelledError(request.requestId));
      return new Promise<RouteReply>((resolve, reject) => {
        const key = keyOf(request.requestId, request.style);
        // The same id and style asked again replaces the earlier ask.
        waiting.get(key)?.reject(new RouteCancelledError(request.requestId));
        waiting.set(key, { requestId: request.requestId, resolve, reject, ...(onProgress ? { onProgress } : {}) });
        try {
          post({ type: 'route', request, grid });
        } catch (error) {
          waiting.delete(key);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },

    cancel(requestId) {
      if (worker) worker.postMessage({ type: 'cancel', requestId } satisfies RouterInbound);
      for (const [key, w] of [...waiting]) {
        if (w.requestId !== requestId) continue;
        waiting.delete(key);
        w.reject(new RouteCancelledError(requestId));
      }
    },

    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
      rejectAll((w) => new RouteCancelledError(w.requestId));
    },
  };
}
