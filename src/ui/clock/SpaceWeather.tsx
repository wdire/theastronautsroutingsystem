import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { relativeTime, type FeedName, type SpaceWeather } from '@/engines/spaceWeather';
import { useApp } from '@/store';
import { refreshSpaceWeather, useSpaceWeather } from '@/ui/hooks/useSpaceWeather';
import { fmtNumber, fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { STATUS_DOT, STATUS_LABEL } from './status';


const FEED_WORDS: Record<FeedName, string> = { enlil: 'the forecast for Mars', sep: 'particle events', flr: 'solar flares' };

function missingLine(missing: FeedName[]): string | null {
  if (missing.length === 0) return null;
  const words = missing.map((m) => FEED_WORDS[m]);
  const joined = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `NASA did not answer for ${joined}.`;
}

function Details({ sw }: { sw: SpaceWeather }) {
  const now = sw.asOfUtcMs;
  const missing = missingLine(sw.missing);
  return (
    <>
      {sw.cmes.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {sw.cmes.map((cme) => (
            <li key={cme.arrivalUtcMs} className="rounded-md border px-2.5 py-2 text-[13px] leading-snug">
              <span className="block font-medium">
                {cme.arrivalUtcMs > now ? 'Reaches Mars' : 'Reached Mars'} <span className="figure">{fmtUtc(cme.arrivalUtcMs)}</span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {cme.glancing ? 'A glancing blow from the edge of the cloud' : 'The cloud meets Mars head on'}
                {cme.speedKms ? `, launched at ${fmtNumber(cme.speedKms)} km/s` : ''}. Modelled by WSA-ENLIL; arrival is good to about half a day.
              </span>
              {cme.link ? (
                <a href={cme.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  The model run at NASA <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        {sw.strongestFlare
          ? `Strongest flare in three days: class ${sw.strongestFlare.classType}, ${relativeTime(sw.strongestFlare.peakUtcMs, now)}.`
          : sw.missing.includes('flr')
            ? ''
            : 'No strong flare (class M or X) in three days.'}{' '}
        {sw.particlesAtMars.length === 0 && !sw.missing.includes('sep')
          ? sw.particlesElsewhere > 0
            ? 'Particle events were seen near Earth this week, none by an instrument at Mars.'
            : 'No particle event this week.'
          : ''}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-faint">
        {sw.fetchedUtcMs ? `Checked ${fmtUtc(sw.fetchedUtcMs)}.` : ''} {missing}
      </p>
    </>
  );
}

/** The live block of the clock menu: what NASA's space weather database says about Mars today. */
export function SpaceWeatherBlock() {
  const sw = useSpaceWeather();
  const failed = useApp((s) => s.spaceWeatherFailed);
  const planned = useApp((s) => s.scenario.solarEvent);
  const setScenario = useApp((s) => s.setScenario);
  const [asking, setAsking] = useState(false);

  return (
    <div className="border-t px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Space weather, live from NASA</h3>
        {sw ? (
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span className={cn('size-2 rounded-full', STATUS_DOT[sw.status])} aria-hidden />
            {STATUS_LABEL[sw.status]}
          </span>
        ) : null}
      </div>
      {sw ? (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed">{sw.headline}</p>
          <Details sw={sw} />
          {sw.status === 'warning' && !planned ? (
            <button
              type="button"
              onClick={() => setScenario({ solarEvent: true })}
              className="mt-2.5 h-8 rounded-md border border-warning/50 px-2.5 text-[13px] font-medium transition-colors hover:bg-warning/10"
            >
              Plan for a solar particle event
            </button>
          ) : null}
        </>
      ) : failed ? (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            NASA&apos;s space weather database did not answer, so there is no live forecast. Plans still work; test one against a particle event with the switch above.
          </p>
          <button
            type="button"
            disabled={asking}
            onClick={() => {
              setAsking(true);
              void refreshSpaceWeather().finally(() => setAsking(false));
            }}
            className="mt-2 h-8 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {asking ? 'Asking NASA' : 'Try again'}
          </button>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted-foreground">Asking NASA.</p>
      )}
    </div>
  );
}
