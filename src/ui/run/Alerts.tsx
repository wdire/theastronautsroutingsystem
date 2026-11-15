import { apply, dropProposed, ignore, takeProposed } from '@/sim/controller';
import { useApp } from '@/store';
import { SEVERITY } from '@/ui/alerts/severity';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useCrew, watchingRun } from '@/net/state';
import { useOpenAlert } from './runState';

const PRIMARY = 'h-9 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 pointer-coarse:h-11';
const QUIET = 'h-9 rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11';

/** "420 m longer", "150 m shorter", "the same length" */
function change(amount: number, unit: (v: number) => string, more: string, less: string, same: string): string {
  if (Math.abs(amount) < 1) return same;
  return `${unit(Math.abs(amount))} ${amount > 0 ? more : less}`;
}

/**
 * One alert with its choices: act, ignore, or weigh a proposed new route before taking it. Placed by the
 * caller: in the mission panel on the left, over Rover View, or over the map on a phone.
 */
export function AlertCard({ inVisor = false, floating = false }: { inVisor?: boolean; floating?: boolean }) {
  const routingId = useApp((s) => s.routingAlertId);
  const proposed = useApp((s) => s.proposed);
  // A crew member sees the alert; acting on it is the commander's call.
  const watching = useCrew(watchingRun);
  const { alert, open } = useOpenAlert();
  if (!alert) return null;
  const look = SEVERITY[alert.severity];
  const warning = alert.severity === 'warning';

  return (
    <div role={warning ? 'alertdialog' : 'status'} aria-label={`${look.word}: ${alert.title}`} className={cn('border-l-4 p-3.5', look.border, floating ? 'panel shadow-2xl' : cn('rounded-md border', look.bg))}>
      <div className="flex items-start gap-2.5">
        <look.icon className={cn('mt-0.5 size-[18px] shrink-0', look.text)} aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            {look.word}
            {warning && !watching ? ' · the crew waits for your call' : ''}
          </p>
          <h2 className="text-[14.5px] leading-snug font-semibold">{alert.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{alert.body}</p>
        </div>
      </div>

      {watching ? (
        <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">The commander decides.{open.length > 1 ? ` ${open.length - 1} more waiting.` : ''}</p>
      ) : proposed ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-[13px] leading-relaxed">
            {inVisor ? 'A new route' : 'A new route, the dashed green line on the map'}: {change(proposed.addedM, fmtDistance, 'longer', 'shorter', 'the same length')}
            {proposed.addedS !== 0 ? `, ${change(proposed.addedS, fmtDuration, 'more', 'less', 'the same time')}` : ''}.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} onClick={takeProposed}>
              Take this route
            </button>
            <button type="button" className={QUIET} onClick={dropProposed}>
              Keep the old one
            </button>
          </div>
        </div>
      ) : routingId === alert.id ? (
        <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground" aria-live="polite">
          Working out a new route over the terrain…
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {alert.action ? (
            <button type="button" className={PRIMARY} onClick={() => void apply(alert.id)}>
              {alert.action.label}
            </button>
          ) : null}
          <button type="button" className={QUIET} onClick={() => ignore(alert.id)}>
            {alert.action ? 'Carry on' : 'Dismiss'}
          </button>
          {open.length > 1 ? <span className="text-xs text-muted-foreground">{open.length - 1} more waiting</span> : null}
        </div>
      )}
    </div>
  );
}

/** The alert as a floating card: over Rover View, and over the map on a phone (which has no mission panel). */
export function Alerts({ inVisor = false }: { inVisor?: boolean }) {
  return (
    <div className={cn('pointer-events-auto absolute left-1/2 w-[min(27rem,calc(100vw-1.5rem))] -translate-x-1/2', inVisor ? 'top-16 max-md:top-[9.75rem]' : 'top-3 max-md:top-[7.75rem]')}>
      <AlertCard inVisor={inVisor} floating />
    </div>
  );
}
