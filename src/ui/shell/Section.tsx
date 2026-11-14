import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useApp } from '@/store';
import { cn } from '@/lib/cn';

/**
 * A detail section that opens on request. The first level of every card stays short;
 * measurements, models and sources live in sections like this one.
 */
export function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  const open = useApp((s) => Boolean(s.sections[id]));
  const toggle = useApp((s) => s.toggleSection);
  return (
    <section className="border-t">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`section-${id}`}
          onClick={() => toggle(id)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            {hint && !open ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open ? (
        <div id={`section-${id}`} className="px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A label and a value on one line, for lists of measurements. */
export function Row({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border/60 py-1.5 text-[13px] first:border-t-0">
      <span className="text-muted-foreground">
        {label}
        {note ? <span className="ml-1.5 text-[11px] text-faint">{note}</span> : null}
      </span>
      <span className="figure text-right font-medium">{value}</span>
    </div>
  );
}
