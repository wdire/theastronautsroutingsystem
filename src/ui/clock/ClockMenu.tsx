import { Moon, Sun, Sunrise } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { useApp } from '@/store';
import { lightTimeS, marsTime, nextLtst, sunPosition } from '@/engines/marsTime';
import { LANDING_SITE } from '@/lib/constants';
import { fmtClock, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Row } from '@/ui/shell/Section';
import type { Scenario } from '@/engines/types';

const [LON, LAT] = LANDING_SITE;

function seasonName(ls: number): string {
  // Northern hemisphere seasons; Jezero is at 18 degrees north.
  if (ls < 90) return 'northern spring';
  if (ls < 180) return 'northern summer';
  if (ls < 270) return 'northern autumn';
  return 'northern winter';
}

const TIMES: readonly { label: string; hour: number | null }[] = [
  { label: 'Now', hour: null },
  { label: 'Morning', hour: 9 },
  { label: 'Noon', hour: 12 },
  { label: 'Afternoon', hour: 15 },
  { label: 'Dusk', hour: 17.5 },
];

const DUST: readonly { id: Scenario['dust']; label: string; note: string }[] = [
  { id: 'clear', label: 'Clear', note: 'The usual dust for the season.' },
  { id: 'regionalStorm', label: 'Regional storm', note: 'A dust storm over part of the region.' },
  { id: 'globalStorm', label: 'Global storm', note: 'Dust around the whole planet, as in 2018.' },
];

function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
            value === o.id ? 'border-primary/60 bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Top right: Jezero's local time. Opens the clock menu. */
export function ClockMenu() {
  const second = useApp((s) => Math.floor(s.utcMs / 1000));
  const scenario = useApp((s) => s.scenario);
  const setScenario = useApp((s) => s.setScenario);
  const setClock = useApp((s) => s.setClock);
  const live = useApp((s) => s.clockLive);
  const utcMs = second * 1000;
  const t = marsTime(utcMs, LON);
  const sun = sunPosition(utcMs, LAT, LON);
  const night = sun.elevDeg < -1;
  const low = !night && sun.elevDeg < 8;
  const Icon = night ? Moon : low ? Sunrise : Sun;
  const light = lightTimeS(utcMs);
  const dust = DUST.find((d) => d.id === scenario.dust);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Local time at Jezero ${fmtClock(t.ltstH)}. Open the Mars clock`}
          className="panel flex h-12 items-center gap-2.5 pr-3.5 pl-3 transition-colors hover:bg-secondary data-[state=open]:bg-secondary"
        >
          <Icon className={cn('size-[18px]', night ? 'text-advisory' : 'text-caution')} aria-hidden />
          <span className="flex flex-col items-start leading-none">
            <span className="figure text-[17px] font-semibold tracking-[-0.01em] [font-stretch:92%]">
              {fmtClock(t.ltstH)}
              <span className="ml-1 text-[11px] font-medium text-muted-foreground">LTST</span>
            </span>
            <span className="mt-1 text-[11px] text-muted-foreground">{night ? 'Night at Jezero' : low ? 'Sun low at Jezero' : 'Day at Jezero'}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[336px] p-0">
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold">Mars clock</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Local true solar time at Jezero: noon is when the sun is highest. A Mars day, a sol, lasts 24 h 39 min.
          </p>
        </div>
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Show the map at</p>
          <div role="radiogroup" aria-label="Time of day" className="flex flex-wrap gap-1">
            {TIMES.map((time) => {
              const checked = time.hour === null ? live : !live && Math.abs(t.ltstH - time.hour) < 0.05;
              return (
                <button
                  key={time.label}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => (time.hour === null ? setClock(Date.now(), true) : setClock(nextLtst(Date.now(), LON, time.hour), false))}
                  className={cn(
                    'h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
                    checked ? 'border-primary/60 bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  {time.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t px-4 py-3">
          <Row label="Season" value={`Ls ${fmtNumber(t.lsDeg, 1)}°, ${seasonName(t.lsDeg)}`} />
          <Row label="Mars year" value={fmtNumber(t.marsYear)} />
          <Row label="Sol number" value={fmtNumber(t.sol)} note="Mars Sol Date" />
          <Row label="Earth time" value={`${new Date(utcMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`} />
          <Row label="Radio delay to Earth" value={`${Math.floor(light / 60)} min ${String(Math.round(light % 60)).padStart(2, '0')} s`} />
        </div>
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">What if the weather were</p>
          <Segments label="Dust" options={DUST} value={scenario.dust} onChange={(id) => setScenario({ dust: id })} />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dust?.note} Modelled, to test a plan against bad days.</p>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-[13px]">
            <span>
              <span className="font-medium">Solar particle event</span>
              <span className="block text-xs text-muted-foreground">A burst of radiation from the Sun reaches Mars.</span>
            </span>
            <input
              type="checkbox"
              checked={scenario.solarEvent}
              onChange={(e) => setScenario({ solarEvent: e.target.checked })}
              className="size-4 accent-[var(--primary)]"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
