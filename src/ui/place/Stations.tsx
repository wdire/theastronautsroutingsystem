import { useEffect, useState } from 'react';
import { loadWeather, type WeatherSol } from '@/data/datasets';
import type { Station, StationReport } from '@/data/stationFeed';
import { fmtNumber, fmtTemp } from '@/lib/format';

interface Reading {
  sol: WeatherSol;
  live: boolean;
}

const STATIONS: readonly { id: Station; rover: string; where: string }[] = [
  { id: 'meda', rover: 'Perseverance', where: 'in Jezero crater' },
  { id: 'rems', rover: 'Curiosity', where: 'in Gale crater, 3,700 km away' },
];

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function liveReport(station: Station, signal: AbortSignal): Promise<WeatherSol | null> {
  try {
    const response = await fetch(`/api/weather?station=${station}`, { signal });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
    const report = (await response.json()) as Partial<StationReport>;
    return Array.isArray(report.sols) ? (report.sols.at(-1) ?? null) : null;
  } catch {
    return null;
  }
}

/** What the rovers' own weather stations last reported: measured, unlike the modelled rows above it. */
export function StationReadings() {
  const [readings, setReadings] = useState<Partial<Record<Station, Reading>>>({});
  const [retrieved, setRetrieved] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The bundled snapshot first, so there is always something; then the live feed where it answers.
    void loadWeather()
      .then((data) => {
        if (controller.signal.aborted) return;
        setRetrieved(data.retrieved);
        setReadings((r) => {
          const next = { ...r };
          for (const { id } of STATIONS) {
            const sol = data[id].at(-1);
            if (sol && !next[id]) next[id] = { sol, live: false };
          }
          return next;
        });
      })
      .catch(() => undefined);
    for (const { id } of STATIONS) {
      void liveReport(id, controller.signal).then((sol) => {
        if (sol && !controller.signal.aborted) setReadings((r) => ({ ...r, [id]: { sol, live: true } }));
      });
    }
    return () => controller.abort();
  }, []);

  const shown = STATIONS.filter((s) => readings[s.id]);
  if (shown.length === 0) return null;
  const anyBundled = shown.some((s) => !readings[s.id]?.live);

  return (
    <div className="mt-4 border-t pt-3">
      <h4 className="text-xs font-medium text-muted-foreground">Measured by the rovers</h4>
      <ul className="mt-2 flex flex-col gap-2.5">
        {shown.map((s) => {
          const reading = readings[s.id];
          if (!reading) return null;
          const { sol } = reading;
          return (
            <li key={s.id} className="text-[13px] leading-snug">
              <span className="block font-medium">
                {s.rover} <span className="font-normal text-muted-foreground">{s.where}</span>
              </span>
              <span className="figure block">
                {sol.minC !== null && sol.maxC !== null ? `${fmtTemp(sol.minC)} to ${fmtTemp(sol.maxC)}` : 'No temperature'}
                {sol.pressurePa !== null ? `, ${fmtNumber(sol.pressurePa)} Pa` : ''}
              </span>
              <span className="block text-xs text-faint">
                Sol {fmtNumber(sol.sol)}, {DATE.format(new Date(`${sol.earthDate}T00:00:00Z`))}. {reading.live ? 'Live from mars.nasa.gov.' : 'From the copy kept with the app.'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-xs leading-relaxed text-faint">
        The lowest and highest air temperature of that sol, and the mean pressure. The rovers report when they can, so the last report may be old
        {anyBundled && retrieved ? `; the app's copy was taken on ${retrieved}` : ''}.
      </p>
    </div>
  );
}
