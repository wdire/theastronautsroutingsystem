/**
 * The one connection to the crew server. Only the lazily loaded net layer imports this file, so the first load
 * does not carry the Convex client.
 */
import { ConvexReactClient } from 'convex/react';
import { ConvexError } from 'convex/values';
import { toast } from 'sonner';
import { CONVEX_URL } from './config';
import { loadIdentity } from './identity';

export const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

/** Who is asking, for every call that needs it. The id and secret never change after the first load. */
export function auth(): { clientId: string; secret: string } {
  const { clientId, secret } = loadIdentity();
  return { clientId, secret };
}

/** The server's own sentence for a refused call, or a plain one for anything else. */
export function errorText(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === 'string') return err.data;
  return 'The crew server did not answer. Check the connection and try again.';
}

/** Shows a failed call the way the server worded it. */
export function toastError(err: unknown): void {
  toast(errorText(err));
}
