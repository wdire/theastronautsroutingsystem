import { useEffect, useState } from 'react';
import { loadWeather, tryFetchJson, type WeatherSol } from '@/data/datasets';
import type { Station, StationReport } from '@/data/stationFeed';
import { fmtDay, fmtNumber, fmtTemp } from '@/lib/format';

interface Reading {
  sol: WeatherSol;
  live: boolean;
}

const STATIONS: readonly { id: Station; rover: string; where: string }[] = [
  { id: 'meda', rover: 'Perseverance', where: 'in Jezero crater' },
  { id: 'rems', rover: 'Curiosity', where: 'in Gale crater, 3,700 km away' },
];

/** The live answer is the same for every place: asked once an hour, however many cards open. */
const live = new Map<Station, { at: number; sol: Promise<WeatherSol | null> }>();
const LIVE_FOR_MS = 60 * 60_000;

function liveReport(station: Station): Promise<WeatherSol | null> {
  const hit = live.get(station);
  if (hit && performance.now() - hit.at < LIVE_FOR_MS) return hit.sol;
  const sol = tryFetchJson(`/api/weather?station=${station}`).then((report) => {
    const sols = (report as Partial<StationReport> | null)?.sols;
    const last = Array.isArray(sols) ? (sols.at(-1) ?? null) : null;
    // A miss is not kept: the next card asks again.
    if (!last) live.delete(station);
    return last;
  });
  live.set(station, { at: performance.now(), sol });
  return sol;
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
      void liveReport(id).then((sol) => {
        if (sol && !controller.signal.aborted) setReadings((r) => ({ ...r, [id]: { sol, live: true } }));
      });
    }
    return () => controller.abort();
  }, []);

  const shown = STATIONS.flatMap((station) => {
    const reading = readings[station.id];
    return reading ? [{ station, reading }] : [];
  });
  if (shown.length === 0) return null;
  const anyBundled = shown.some(({ reading }) => !reading.live);

  return (
    <div className="mt-4 border-t pt-3">
      <h4 className="text-xs font-medium text-muted-foreground">Measured by the rovers</h4>
      <ul className="mt-2 flex flex-col gap-2.5">
        {shown.map(({ station: s, reading }) => {
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
                Sol {fmtNumber(sol.sol)}, {fmtDay(sol.earthDate)}. {reading.live ? 'Live from mars.nasa.gov.' : 'From the copy kept with the app.'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-xs leading-relaxed text-faint">
        The lowest and highest air temperature of that sol, and the mean pressure. The rovers report when they can, so the last report may be old
        {anyBundled && retrieved ? `; the app’s copy was taken on ${retrieved}` : ''}.
      </p>
    </div>
  );
}
