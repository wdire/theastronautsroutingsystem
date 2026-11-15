/**
 * Moving the base. There is one base, shared by everyone, so a move is asked for and then confirmed: the spot
 * is checked (region, slope), a dialog says what moving it means, and only then is it moved, on the crew
 * server when there is one (everyone sees it move) or in this browser alone otherwise.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { groundAt } from '@/data/dem';
import { distanceM } from '@/lib/geo';
import { useApp } from '@/store';
import { baseSpotProblem, type Base } from './base';

/** Moves the shared base on the crew server. Set by the crew layer once it is connected; rejects with a reason. */
type RemoteMover = (base: Base) => Promise<void>;
let remote: RemoteMover | null = null;
export function setBaseMover(fn: RemoteMover | null): void {
  remote = fn;
}

export interface BaseMoveAsk {
  lon: number;
  lat: number;
  slopeDeg: number | null;
  /** Why the base cannot stand there, or null. */
  problem: string | null;
  /** Straight-line distance from where the base is now, m. */
  fromM: number;
}

/** The move waiting for the visitor to confirm, shown by BaseMoveDialog. */
export const useBaseMove = create<{ ask: BaseMoveAsk | null; busy: boolean }>()(() => ({ ask: null, busy: false }));

/** Why the base cannot move right now, or null. The crew server also refuses while any crew is out. */
export function baseMoveBlocked(): string | null {
  if (useApp.getState().world?.run?.status === 'running') return 'A mission is out from the base. It can move once the mission is back.';
  return null;
}

/** Asks to move the base to a point: checks the ground there, then opens the confirmation. */
export async function moveBaseTo(lon: number, lat: number): Promise<void> {
  const blocked = baseMoveBlocked();
  if (blocked) {
    toast('The base cannot move now', { description: blocked });
    return;
  }
  const slope = await groundAt(lon, lat)
    .then((g) => g.slopeDeg)
    .catch(() => null);
  const base = useApp.getState().base;
  useBaseMove.setState({ ask: { lon, lat, slopeDeg: slope, problem: baseSpotProblem(lon, lat, slope), fromM: distanceM(base.lon, base.lat, lon, lat) } });
}

async function apply(next: Base): Promise<void> {
  if (remote) await remote(next);
  // The server's answer comes back through the shared-base subscription too; setting it here makes the move
  // show at once, and is the whole move when there is no crew server.
  useApp.getState().setBase(next);
}

/** Moves the base to the asked-for spot. Resolves false if it could not (the reason is shown). */
export async function confirmBaseMove(): Promise<boolean> {
  const { ask } = useBaseMove.getState();
  if (!ask || ask.problem) return false;
  const blocked = baseMoveBlocked();
  if (blocked) {
    toast('The base cannot move now', { description: blocked });
    return false;
  }
  const before = useApp.getState().base;
  useBaseMove.setState({ busy: true });
  try {
    await apply({ ...before, lon: ask.lon, lat: ask.lat });
  } catch (err) {
    toast('The base did not move', { description: err instanceof Error ? err.message.replace(/^.*ConvexError: /, '').replace(/\s+at .*$/s, '') : String(err) });
    return false;
  } finally {
    useBaseMove.setState({ busy: false });
  }
  useBaseMove.setState({ ask: null });
  toast(`${before.name} moved`, {
    description: remote ? 'Everyone’s missions now start and end here.' : 'Missions now start and end here.',
    action: { label: 'Undo', onClick: () => void apply(before).catch(() => toast('The base could not move back')) },
  });
  return true;
}

export function cancelBaseMove(): void {
  useBaseMove.setState({ ask: null, busy: false });
}
