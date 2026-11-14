import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const REACH = 38;

/** A thumb pad for walking on touch screens. Push it to its edge to go at rover speed. */
export function MovePad({ onMove }: { onMove: (right: number, forward: number, fast: boolean) => void }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const centre = useRef<{ x: number; y: number } | null>(null);

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const c = centre.current;
    if (!c) return;
    let dx = e.clientX - c.x;
    let dy = e.clientY - c.y;
    const d = Math.hypot(dx, dy);
    if (d > REACH) {
      dx = (dx / d) * REACH;
      dy = (dy / d) * REACH;
    }
    setKnob({ x: dx, y: dy });
    // Up the screen is forward.
    onMove(dx / REACH, -dy / REACH, d >= REACH * 0.96);
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    centre.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setKnob({ x: 0, y: 0 });
    onMove(0, 0, false);
  };

  return (
    <div
      role="group"
      aria-label="Walk: drag the pad the way you want to go"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        centre.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className="pointer-events-auto relative size-[116px] touch-none rounded-full border border-white/35 bg-black/30 backdrop-blur-[2px] select-none"
    >
      <span
        className="absolute top-1/2 left-1/2 size-11 rounded-full border border-white/60 bg-white/25"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        aria-hidden
      />
    </div>
  );
}
