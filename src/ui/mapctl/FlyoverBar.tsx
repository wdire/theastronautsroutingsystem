import { useApp } from '@/store';
import { stopFlyover } from '@/map/flyover';
import { fmtDistance } from '@/lib/format';

/** Shown while the camera flies the route: where it is heading, and a way to stop. */
export function FlyoverBar() {
  const flyover = useApp((s) => s.flyover);
  if (!flyover) return null;
  return (
    <div role="status" className="panel pointer-events-auto absolute top-3 left-1/2 flex h-11 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 overflow-hidden pr-1 pl-3.5 text-[13px] whitespace-nowrap max-md:top-[7.75rem]">
      {/* A fixed width, so Stop stays put as the names and distances change. */}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">Next </span>
        <span className="font-medium">{flyover.next}</span>
        {/* A fixed width, so the bar does not jitter as the distance counts down. */}
        <span className="figure inline-block min-w-[4.25rem] text-muted-foreground">, {fmtDistance(flyover.remainingM)}</span>
      </span>
      <button type="button" onClick={stopFlyover} className="h-9 shrink-0 rounded-md px-2.5 font-medium text-primary transition-colors hover:bg-secondary">
        Stop
      </button>
      <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary" style={{ transform: `scaleX(${flyover.progress})` }} aria-hidden />
    </div>
  );
}
