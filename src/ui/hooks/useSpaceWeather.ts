import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { MAX_AGE_MS, loadSpaceWeather } from '@/data/spaceWeather';
import { summarizeSpaceWeather, type SpaceWeather } from '@/engines/spaceWeather';
import { useApp } from '@/store';

// Real time, not the app clock: a forecast is about today even while the map shows another hour.
let realMinute = Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribeMinute(onChange: () => void): () => void {
  realMinute = Math.floor(Date.now() / 60_000);
  listeners.add(onChange);
  timer ??= window.setInterval(() => {
    const minute = Math.floor(Date.now() / 60_000);
    if (minute === realMinute) return;
    realMinute = minute;
    for (const listener of listeners) listener();
  }, 10_000);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The live summary, re-read each minute so "in 5 hours" stays true. Null until the feeds arrive. */
export function useSpaceWeather(): SpaceWeather | null {
  const feed = useApp((s) => s.spaceWeather);
  const minute = useSyncExternalStore(subscribeMinute, () => realMinute);
  return useMemo(() => (feed ? summarizeSpaceWeather(feed, minute * 60_000) : null), [feed, minute]);
}

const TOLD_KEY = 'areo.spaceweather.told';

/** Asks again now, for the "Try again" button. */
export async function refreshSpaceWeather(): Promise<void> {
  useApp.getState().setSpaceWeather(await loadSpaceWeather(Date.now(), new AbortController().signal));
}

/** Fetches the feeds once the visitor has landed, refreshes them, and says so once per visit if a storm is due. */
export function useSpaceWeatherFeed(): void {
  const landed = useApp((s) => s.landed);
  useEffect(() => {
    if (!landed) return;
    const controller = new AbortController();
    const refresh = () => {
      void loadSpaceWeather(Date.now(), controller.signal).then((feed) => {
        if (controller.signal.aborted) return;
        useApp.getState().setSpaceWeather(feed);
        if (!feed) return;
        const sw = summarizeSpaceWeather(feed, Date.now());
        if (sw.status !== 'watch' && sw.status !== 'warning') return;
        try {
          if (sessionStorage.getItem(TOLD_KEY)) return;
          sessionStorage.setItem(TOLD_KEY, '1');
        } catch {
          // No session storage: the toast may repeat after a reload, which is harmless.
        }
        toast(sw.status === 'warning' ? 'Space weather warning' : 'Space weather watch', { description: `${sw.headline} Live from NASA. Details are in the Mars clock.`, duration: 9000 });
      });
    };
    refresh();
    const id = window.setInterval(refresh, MAX_AGE_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [landed]);
}
