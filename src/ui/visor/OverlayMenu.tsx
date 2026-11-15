import { useEffect, useRef, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import { useApp } from '@/store';
import { cn } from '@/lib/cn';
import { OVERLAY_ITEMS as ITEMS } from './overlayNames';

/** A corner button in Rover View that picks what the map in hand (and the map itself) lays over the ground. */
export function OverlayMenu({ className }: { className?: string }) {
  const overlay = useApp((s) => s.layers.overlay);
  const setLayers = useApp((s) => s.setLayers);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('pointer-events-auto relative', className)}>
      {open ? (
        <div role="radiogroup" aria-label="Overlay" className="panel absolute right-0 bottom-full mb-2 flex w-[18.5rem] flex-col gap-0.5 p-1">
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Overlay on the map</p>
          {ITEMS.map((item) => {
            const checked = overlay === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  setLayers({ overlay: item.id });
                  setOpen(false);
                }}
                className={cn('flex items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors', checked ? 'bg-primary/15' : 'hover:bg-secondary')}
              >
                <Check className={cn('mt-0.5 size-4 shrink-0 text-primary', !checked && 'invisible')} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{item.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-label="Overlays"
        onClick={() => setOpen((v) => !v)}
        className={cn('panel inline-flex h-10 items-center gap-2 px-3 text-[13px] font-medium hover:bg-secondary', open && 'bg-secondary')}
      >
        <Layers className="size-4" aria-hidden />
        Overlays
        {overlay !== 'none' ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
      </button>
    </div>
  );
}
