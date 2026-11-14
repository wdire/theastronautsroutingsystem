import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { STOP_WORD, settle, sheetHeights, type SheetStop } from './sheetStops';

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.visualViewport?.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.visualViewport?.removeEventListener('resize', onChange);
  };
}

interface SheetProps {
  stop: SheetStop;
  onStop: (stop: SheetStop) => void;
  /** What the sheet holds, for the handle's label: "Mission plan". */
  label: string;
  /** Space kept clear above the sheet at full height and below it, px. */
  topClear: number;
  bottomClear: number;
  children: ReactNode;
}

/**
 * A phone bottom sheet with three stops. It does not block the map behind it. Drag the handle, or
 * activate it to step through the stops.
 */
export function Sheet({ stop, onStop, label, topClear, bottomClear, children }: SheetProps) {
  const viewportH = useSyncExternalStore(subscribeResize, () => window.visualViewport?.height ?? window.innerHeight);
  const heights = sheetHeights(viewportH, topClear, bottomClear);
  const [dragH, setDragH] = useState<number | null>(null);
  // The content keeps the taller layout while the sheet slides down, so it is never cut off mid-move.
  const [laidOut, setLaidOut] = useState(stop);
  const drag = useRef<{ startY: number; startH: number; lastY: number; lastT: number; velocity: number; moved: boolean } | null>(null);

  useEffect(() => {
    // Once the slide is over the content takes the height of the stop. A timer, not transitionend:
    // a sheet let go exactly on its stop does not move, so no transition ever ends.
    const id = window.setTimeout(() => setLaidOut(stop), 240);
    return () => window.clearTimeout(id);
  }, [stop]);

  const visible = dragH ?? heights[stop];
  const contentH = Math.max(heights[laidOut], heights[stop], dragH ?? 0);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: heights[stop], lastY: e.clientY, lastT: e.timeStamp, velocity: 0, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.velocity = d.velocity * 0.5 + ((d.lastY - e.clientY) / dt) * 0.5;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragH(Math.max(heights.peek - 24, Math.min(heights.full, d.startH + dy)));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d?.moved) return;
    onStop(settle(dragH ?? d.startH, d.velocity, heights));
    setDragH(null);
  };
  const step = () => {
    // A tap, or Enter: up one stop, and from the top back to half.
    if (drag.current?.moved) return;
    onStop(stop === 'peek' ? 'half' : stop === 'half' ? 'full' : 'half');
  };

  return (
    <div
      className={cn('panel pointer-events-auto absolute inset-x-0 flex flex-col overflow-hidden rounded-b-none border-x-0 border-b-0 will-change-transform', dragH === null && 'transition-transform duration-200 ease-out')}
      style={{ bottom: bottomClear, height: heights.full, transform: `translateY(${heights.full - visible}px)` }}
    >
      <button
        type="button"
        aria-label={`${label}: ${STOP_WORD[stop]}. Drag to resize, or press to change the height`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={step}
        className="flex h-6 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1 w-9 rounded-full bg-foreground/25" aria-hidden />
      </button>
      <div
        className="flex min-h-0 flex-col [&>*]:min-h-0 [&>*]:w-full! [&>*]:max-w-none! [&>*]:flex-1 [&>*]:rounded-none! [&>*]:border-0! [&>*]:bg-transparent! [&>*]:shadow-none!"
        style={{ height: contentH - 24 }}
      >
        {children}
      </div>
    </div>
  );
}
