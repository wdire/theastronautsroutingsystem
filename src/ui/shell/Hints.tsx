import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '@/store';
import { useIsPhone, useIsTouch } from '@/ui/hooks/useMediaQuery';

const KEY = 'areo.hints.v1';
const STEPS = 3;

function readStep(): number {
  try {
    const n = Number(localStorage.getItem(KEY) ?? '0');
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStep(step: number): void {
  try {
    localStorage.setItem(KEY, String(step));
  } catch {
    // No storage: the hints show again on the next visit, which is harmless.
  }
}

/**
 * Three hints for a first visit, one at a time: look at a place, plan a mission, run it. Each goes
 * away when the visitor has done what it says, and the cross dismisses them all for good.
 */
export function Hints() {
  const touch = useIsTouch();
  const [step, setStep] = useState(readStep);
  const landed = useApp((s) => s.landed);
  // What the visitor has done, read from the app's own state: no separate bookkeeping to go stale.
  const sawPlace = useApp((s) => s.placeId !== null);
  const planned = useApp((s) => s.plan.start !== null && s.plan.stops.length > 0);
  const sheetOpen = useApp((s) => s.placeId !== null || s.plannerOpen || s.dock !== null);
  const phone = useIsPhone();
  const ran = useApp((s) => s.flyover !== null || s.visor !== null);

  const reached = ran ? 3 : planned ? 2 : sawPlace ? 1 : 0;
  const shown = Math.max(step, reached);
  useEffect(() => {
    if (shown !== step) writeStep(shown);
  }, [shown, step]);

  // On a phone an open sheet has the bottom of the screen; the hint waits until it is closed.
  if (!landed || shown >= STEPS || (phone && sheetOpen)) return null;
  const verb = touch ? 'Tap' : 'Click';
  const text = [
    `${verb} anywhere on the map, or search, to see what is there.`,
    'Plan a mission: choose a start, then add the places you want to work at.',
    'Fly along the route to see the ground it crosses, or stand on it in Rover View.',
  ][shown];

  return (
    <div role="note" className="panel pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 py-2 pr-1.5 pl-3.5 max-md:bottom-[5.25rem]">
      <span className="figure shrink-0 text-xs text-muted-foreground">
        {shown + 1} of {STEPS}
      </span>
      <p className="text-[13px] leading-snug">{text}</p>
      <button
        type="button"
        aria-label="Hide the hints"
        onClick={() => {
          writeStep(STEPS);
          setStep(STEPS);
        }}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground pointer-coarse:size-11"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
