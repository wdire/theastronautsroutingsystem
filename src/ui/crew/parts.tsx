import type { ReactNode } from 'react';
import { Bot } from 'lucide-react';
import { SUIT_COLOR_HEX, type CrewColor } from '../../../convex/shared';
import { fmtUtc } from '@/lib/format';
import { fmtMarsMoment } from './format';
import { cn } from '@/lib/cn';
import type { MissionStatus } from '@/net/state';

export const QUIET_BTN = 'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11';
export const PRIMARY_BTN = 'inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11';
export const ICON_BTN = 'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-11';
export const FIELD = 'h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[13px] outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 pointer-coarse:h-11';

/** The suit band's colour as a small round swatch. */
export function Swatch({ color, size = 'md', className }: { color: CrewColor; size?: 'sm' | 'md'; className?: string }) {
  return <span aria-hidden className={cn('inline-block shrink-0 rounded-full ring-1 ring-black/30', size === 'sm' ? 'size-2.5' : 'size-3.5', className)} style={{ backgroundColor: SUIT_COLOR_HEX[color] }} />;
}

/** A crew member's mark: a swatch for a person, a small robot for an android. */
export function CrewMark({ color, android }: { color: CrewColor; android: boolean }) {
  if (!android) return <Swatch color={color} />;
  return (
    <span aria-hidden className="grid size-3.5 shrink-0 place-items-center rounded-full bg-[#5c6166] text-white">
      <Bot className="size-2.5" />
    </span>
  );
}

const STATUS_WORD: Record<MissionStatus, string> = { planning: 'Planning', underway: 'Under way', complete: 'Complete', aborted: 'Aborted' };
const STATUS_TONE: Record<MissionStatus, string> = { planning: 'bg-advisory/15 text-advisory', underway: 'bg-ok/15 text-ok', complete: 'bg-secondary text-foreground/85', aborted: 'bg-warning/15 text-warning' };

export function StatusChip({ status, label }: { status: MissionStatus; label?: string }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-semibold', STATUS_TONE[status])}>{label ?? STATUS_WORD[status]}</span>;
}

/** Both clocks, as the debrief and the departure show a moment. */
export function Moment({ utcMs, lon }: { utcMs: number; lon: number }) {
  return (
    <span className="figure">
      {fmtMarsMoment(utcMs, lon)}
      <span className="text-muted-foreground"> · {fmtUtc(utcMs, true)}</span>
    </span>
  );
}

/** A small heading inside a panel section. */
export function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {aside ? <span className="figure text-xs text-muted-foreground">{aside}</span> : null}
    </div>
  );
}
