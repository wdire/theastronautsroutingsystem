import { marsTime } from '@/engines/marsTime';
import type { Vehicle } from '@/engines/types';
import { useApp } from '@/store';
import { Switch } from '@/ui/components/ui/switch';
import { fmtClock } from '@/lib/format';

const LINK = 'inline-flex h-8 items-center rounded-md border px-2.5 text-[12.5px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11';

/** "today", "tomorrow", "in 3 sols": how many Martian days from now a moment is. */
function dayWord(utcMs: number, nowUtcMs: number, lon: number): string {
  const sols = Math.floor(marsTime(utcMs, lon).sol) - Math.floor(marsTime(nowUtcMs, lon).sol);
  return sols <= 0 ? 'today' : sols === 1 ? 'tomorrow' : `in ${sols} sols`;
}

/**
 * When the mission leaves. Left alone, the app picks the first morning the whole trip fits in
 * daylight; the visitor can leave now instead, and a rover with a cabin can camp on the way.
 */
export function Departure({ departUtcMs, moved, lon, vehicle }: { departUtcMs: number; moved: boolean; lon: number; vehicle: Vehicle }) {
  const chosen = useApp((s) => s.departUtcMs !== null);
  const now = useApp((s) => Math.floor(s.utcMs / 60_000) * 60_000);
  const camp = useApp((s) => s.plan.campAtNight);
  const setDepart = useApp((s) => s.setDepartUtcMs);
  const setCamp = useApp((s) => s.setCampAtNight);
  const leaves = marsTime(departUtcMs, lon).ltstH;
  const leavingNow = Math.abs(departUtcMs - now) < 2 * 60_000;

  return (
    <div className="mb-3 rounded-md border p-3">
      <p className="text-[13px] leading-relaxed">
        <span className="text-muted-foreground">Leaves </span>
        <span className="figure font-semibold">
          {leavingNow ? 'now' : fmtClock(leaves)}
          {leavingNow ? '' : ` ${dayWord(departUtcMs, now, lon)}`}
        </span>
        <span className="text-muted-foreground">{leavingNow ? `, ${fmtClock(leaves)} local solar time.` : ', local solar time.'}</span>
      </p>
      {moved ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The first morning the whole trip fits in daylight, half an hour after sunrise.</p> : null}
      {moved || chosen ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {moved ? (
            <button type="button" className={LINK} onClick={() => setDepart(useApp.getState().utcMs)}>
              Leave now instead
            </button>
          ) : null}
          {chosen ? (
            <button type="button" className={LINK} onClick={() => setDepart(null)}>
              Pick the best morning
            </button>
          ) : null}
        </div>
      ) : null}
      {vehicle.canCamp ? (
        <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-3 border-t pt-2.5 text-[13px]">
          <span>
            <span className="font-medium">Camp overnight on the way</span>
            <span className="block text-xs text-muted-foreground">Park at sunset and go on after sunrise. Off: drive through the night.</span>
          </span>
          <Switch checked={camp} onCheckedChange={setCamp} aria-label="Camp overnight on the way" />
        </label>
      ) : null}
    </div>
  );
}
