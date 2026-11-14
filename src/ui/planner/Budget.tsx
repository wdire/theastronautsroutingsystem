import { useEffect, useMemo, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { loadGeology } from '@/data/datasets';
import { explainRoute } from '@/engines/explain';
import type { GeologyData } from '@/engines/geology';
import { marsTime } from '@/engines/marsTime';
import type { RouteAlternative, TripResult, TripWarning, Vehicle } from '@/engines/types';
import { distanceM } from '@/lib/geo';
import { fmtClock, fmtDeg, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { SEVERITY, SEVERITY_ORDER } from '@/ui/alerts/severity';
import { Section } from '@/ui/shell/Section';
import { Profile } from './Profile';

/** Natural background radiation on Earth, about 2.4 mSv a year, per day. */
const EARTH_MSV_PER_DAY = 2.4 / 365.25;

function Tile({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="figure mt-0.5 text-[17px] leading-tight font-medium [font-stretch:92%]">{value}</dd>
      {note ? <dd className="mt-0.5 text-[11.5px] leading-snug text-faint">{note}</dd> : null}
    </div>
  );
}

/** "about 6 weeks of natural background on Earth" */
function earthDose(mSv: number): string {
  const days = mSv / EARTH_MSV_PER_DAY;
  if (days < 1.5) return 'about a day of natural background on Earth';
  if (days < 21) return `about ${Math.round(days)} days of natural background on Earth`;
  if (days < 75) return `about ${Math.round(days / 7)} weeks of natural background on Earth`;
  return `about ${Math.round(days / 30.4)} months of natural background on Earth`;
}

function byWorst(warnings: readonly TripWarning[]): TripWarning[] {
  return [...warnings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

/** The one sentence a visitor needs first: does this plan work. */
function Verdict({ trip }: { trip: TripResult }) {
  const worst = byWorst(trip.warnings)[0];
  if (trip.feasible) {
    const t = trip.totals;
    const margin =
      t.minO2Frac !== null ? `The crew is back with ${fmtPercent(t.minO2Frac)} of its oxygen.` : t.minBatteryFrac !== null ? `The battery never drops below ${fmtPercent(t.minBatteryFrac)}.` : '';
    return (
      <p className="flex items-start gap-2 text-[13px] leading-relaxed">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        <span>
          <span className="font-medium">This plan works.</span> {margin}
        </span>
      </p>
    );
  }
  const look = SEVERITY.warning;
  return (
    <p role="alert" className={cn('flex items-start gap-2 rounded-md border p-2.5 text-[13px] leading-relaxed', look.border, look.bg)}>
      <look.icon className={cn('mt-0.5 size-4 shrink-0', look.text)} aria-hidden />
      <span>
        <span className="font-medium">This plan does not work as it stands.</span> {worst?.text ?? 'A limit is reached before the end.'}
      </span>
    </p>
  );
}

function Warnings({ warnings, skipFirst }: { warnings: readonly TripWarning[]; skipFirst: boolean }) {
  const list = byWorst(warnings).slice(skipFirst ? 1 : 0);
  if (list.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {list.map((w) => {
        const look = SEVERITY[w.severity];
        return (
          <li key={`${w.code}:${w.index ?? ''}`} className="flex items-start gap-2 text-[12.5px] leading-relaxed">
            <look.icon className={cn('mt-0.5 size-3.5 shrink-0', look.text)} aria-hidden />
            <span>
              <span className="sr-only">{look.word}: </span>
              {w.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Briefing({ alt, vehicle }: { alt: RouteAlternative; vehicle: Vehicle }) {
  const [geo, setGeo] = useState<GeologyData | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadGeology()
      .then((g) => {
        if (!cancelled) setGeo(g);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const lines = useMemo(() => {
    // The straight line through the same waypoints: what the route is compared with.
    let straightLineM = 0;
    for (let i = 1; i < alt.stopIndices.length; i += 1) {
      const a = alt.path[alt.stopIndices[i - 1] ?? 0];
      const b = alt.path[alt.stopIndices[i] ?? 0];
      if (a && b) straightLineM += distanceM(a[0], a[1], b[0], b[1]);
    }
    return explainRoute({ path: [...alt.path], trip: alt.trip, vehicle, straightLineM, stops: alt.stopIndices.slice(1, -1).map((index) => ({ index })), ...(geo ? { geo } : {}) });
  }, [alt, vehicle, geo]);
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={line} className="text-[13px] leading-relaxed text-foreground/90">
          {line}
        </li>
      ))}
    </ul>
  );
}

/** Everything the trip budget says about a route: whether it works, the numbers, the profile, the briefing. */
export function Budget({ alt, vehicle }: { alt: RouteAlternative; vehicle: Vehicle }) {
  const { trip } = alt;
  const t = trip.totals;
  const end = alt.path[alt.path.length - 1];
  const arrive = end ? marsTime(t.arriveUtcMs, end[0]).ltstH : null;
  const powered = t.minBatteryFrac !== null;
  return (
    <div>
      <Verdict trip={trip} />
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3.5">
        <Tile label="Time" value={fmtDuration(t.durationS)} note={t.workS > 0 ? `${fmtDuration(t.workS)} of it at work` : undefined} />
        <Tile label="Distance" value={fmtDistance(t.distM)} />
        <Tile label="Back at" value={arrive === null ? 'n/a' : fmtClock(arrive)} note="local solar time" />
        {t.minO2Frac !== null ? <Tile label="Oxygen" value={`${fmtNumber(t.o2Kg, 2)} kg`} note={`${fmtPercent(Math.max(0, t.minO2Frac))} left at the lowest`} /> : null}
        {powered ? <Tile label="Energy" value={`${fmtNumber(t.energyKWh, t.energyKWh < 10 ? 1 : 0)} kWh`} note={`battery ${fmtPercent(Math.max(0, t.minBatteryFrac ?? 0))} at the lowest`} /> : <Tile label="Climb" value={`${fmtNumber(t.climbM)} m`} />}
        <Tile label="Steepest" value={fmtDeg(t.maxGradeDeg, 1)} />
      </dl>
      <dl className="mt-3.5">
        <Tile label="Radiation dose, modelled" value={`${fmtNumber(t.doseMSv, 2)} mSv`} note={earthDose(t.doseMSv)} />
      </dl>
      <Profile path={alt.path} stopIndices={alt.stopIndices} trip={trip} comfortDeg={vehicle.comfortSlopeDeg} blockDeg={vehicle.blockSlopeDeg} />
      <Warnings warnings={trip.warnings} skipFirst={!trip.feasible} />
      <div className="-mx-4 mt-3">
        <Section id="route-briefing" title="Briefing" hint="The route in a few sentences">
          <Briefing alt={alt} vehicle={vehicle} />
        </Section>
      </div>
    </div>
  );
}
