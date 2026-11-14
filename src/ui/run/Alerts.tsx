import { sortAlerts } from '@/engines/alerts';
import { apply, dropProposed, ignore, takeProposed } from '@/sim/controller';
import { useApp } from '@/store';
import { SEVERITY } from '@/ui/alerts/severity';
import { fmtDistance, fmtDuration } from '@/lib/format';
import { cn } from '@/lib/cn';

const PRIMARY = 'h-9 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 pointer-coarse:h-11';
const QUIET = 'h-9 rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11';

/** "420 m longer", "150 m shorter", "the same length" */
function change(amount: number, unit: (v: number) => string, more: string, less: string, same: string): string {
  if (Math.abs(amount) < 1) return same;
  return `${unit(Math.abs(amount))} ${amount > 0 ? more : less}`;
}

/**
 * The alert the crew should look at now: the most severe one still open. A warning sits in the middle
 * of the screen and holds the mission until it is answered; the rest sit at the top and can wait.
 * A proposed new route is shown the same way, with what it costs, before it is taken. The same card,
 * with the same look, is used over the map and in the helmet view.
 */
export function Alerts({ inVisor = false }: { inVisor?: boolean }) {
  const alerts = useApp((s) => s.world?.alerts);
  const routingId = useApp((s) => s.routingAlertId);
  const proposed = useApp((s) => s.proposed);
  const open = sortAlerts((alerts ?? []).filter((a) => !a.resolved));
  const alert = proposed ? open.find((a) => a.id === proposed.alertId) : open[0];
  if (!alert) return null;
  const look = SEVERITY[alert.severity];
  const centred = alert.severity === 'warning';

  return (
    <div
      role={centred ? 'alertdialog' : 'status'}
      aria-label={`${look.word}: ${alert.title}`}
      className={cn(
        'panel pointer-events-auto absolute left-1/2 w-[min(27rem,calc(100vw-1.5rem))] -translate-x-1/2 border-l-4 p-3.5',
        look.border,
        centred ? 'top-[26%] shadow-2xl' : inVisor ? 'top-16 max-md:top-[9.75rem]' : 'top-3 max-md:top-[7.75rem]',
      )}
    >
      <div className="flex items-start gap-2.5">
        <look.icon className={cn('mt-0.5 size-[18px] shrink-0', look.text)} aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">{look.word}</p>
          <h2 className="text-[14.5px] leading-snug font-semibold">{alert.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{alert.body}</p>
        </div>
      </div>

      {proposed ? (
        <div className="mt-3 border-t pt-3">
          <p className="text-[13px] leading-relaxed">
            {inVisor ? 'A new route' : 'A new route, the dashed green line'}: {change(proposed.addedM, fmtDistance, 'longer', 'shorter', 'the same length')}
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
          Working out a new route…
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {alert.action ? (
            <button type="button" className={PRIMARY} onClick={() => void apply(alert.id)}>
              {alert.action.label}
            </button>
          ) : null}
          <button type="button" className={QUIET} onClick={() => ignore(alert.id)}>
            {alert.action ? 'Ignore' : 'Dismiss'}
          </button>
          {open.length > 1 ? <span className="text-xs text-muted-foreground">{open.length - 1} more waiting</span> : null}
        </div>
      )}
    </div>
  );
}
