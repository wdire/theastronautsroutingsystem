/**
 * The router's Web Worker: routes one request at a time off the main thread.
 *
 * In:  { type: 'route', request, grid }   route this request on this grid (a GridSpec)
 *      { type: 'cancel', requestId }      drop every queued or running request with this id
 * Out: { type: 'progress', requestId, style, fraction }
 *      { type: 'reply', reply }           the RouteReply; nothing is sent for a cancelled request
 *
 * The search runs in batches and gives the thread back between them, so a cancel is seen within a
 * few milliseconds and a search can never hold the worker for good.
 */
import { makeGrid } from '../terrain';
import type { GridSpec } from '../terrain';
import type { RouteReply, RouteRequest, RouteStyle } from '../types';
import { routeOnGridAsync } from './core';
import { makeCost } from './cost';

export type RouterInbound =
  | { type: 'route'; request: RouteRequest; grid: GridSpec }
  | { type: 'cancel'; requestId: number };

export type RouterOutbound =
  | { type: 'progress'; requestId: number; style: RouteStyle; fraction: number }
  | { type: 'reply'; reply: RouteReply };

/** The little of the worker global this file uses (the project does not load the "webworker" lib). */
interface WorkerScope {
  onmessage: ((event: { data: RouterInbound }) => void) | null;
  postMessage(message: RouterOutbound): void;
}

const scope = self as unknown as WorkerScope;

const queue: { request: RouteRequest; grid: GridSpec }[] = [];
const cancelled = new Set<number>();
let running = false;

/**
 * Give the thread back so waiting messages (a cancel, the next request) are delivered. A timer, not a
 * message to self: a timer task cannot crowd out the messages from the page. Nested timers are held
 * to about 4 ms, which the batch size below keeps to a small share of the search time.
 */
function pause(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function routeOne(request: RouteRequest, spec: GridSpec): Promise<RouteReply | null> {
  const { requestId, style } = request;
  try {
    const grid = makeGrid(spec);
    const cost = makeCost(grid, request);
    let sent = -1;
    return await routeOnGridAsync(request, grid, cost, {
      batch: 16_384,
      pause,
      shouldCancel: () => cancelled.has(requestId),
      onProgress: (fraction) => {
        // A step of 1% is as fine as a progress bar shows.
        if (fraction >= 1 || fraction - sent >= 0.01) {
          sent = fraction;
          scope.postMessage({ type: 'progress', requestId, style, fraction });
        }
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      requestId,
      style,
      reason: 'noPath',
      message: `The route could not be worked out. Move a point a little and try again. (${detail})`,
    };
  }
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  for (;;) {
    const job = queue.shift();
    if (!job) break;
    const id = job.request.requestId;
    if (cancelled.has(id)) continue;
    const reply = await routeOne(job.request, job.grid);
    if (reply && !cancelled.has(id)) scope.postMessage({ type: 'reply', reply });
  }
  running = false;
  // Nothing is queued or running, so no cancel can still apply.
  cancelled.clear();
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i]?.request.requestId === message.requestId) queue.splice(i, 1);
    }
    if (!running) cancelled.clear();
    return;
  }
  if (message.type === 'route') {
    queue.push({ request: message.request, grid: message.grid });
    void drain();
  }
};
