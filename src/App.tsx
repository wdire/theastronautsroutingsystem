import { lazy, Suspense, useEffect } from 'react';
import { MapView } from '@/map/MapView';
import { whenMapReady } from '@/map/instance';
import { startUrlSync } from '@/store/sync';
import { Intro } from '@/ui/intro/Intro';
import { Starfield } from '@/ui/intro/Starfield';
import { useApp } from '@/store';
import { cn } from '@/lib/cn';
import { NET_ENABLED } from '@/net/config';
import { startSoundCues } from '@/audio/wire';

// The opening screen needs the planet and one button. Search, panels and the planner load beside it,
// and are there well before the flight down ends.
const loadChrome = () => import('@/ui/shell/Chrome');
const Chrome = lazy(() => loadChrome().then((m) => ({ default: m.Chrome })));
// With a crew server, the crew layer wraps the chrome. Both chunks are asked for at once, so neither waits on the other.
const NetRoot = NET_ENABLED
  ? lazy(() => {
      void loadChrome();
      return import('@/net/NetRoot');
    })
  : null;
const Toasts = lazy(() => import('@/ui/shell/Chrome').then((m) => ({ default: m.Toasts })));
// three.js and the 3D view load only when they are first opened.
const RoverView = lazy(() => import('@/ui/visor/RoverView'));

export function App() {
  const mode = useApp((s) => s.mode);
  const landed = useApp((s) => s.landed);
  const theme = useApp((s) => s.theme);
  const visorOpen = useApp((s) => s.visor !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    whenMapReady((map) => {
      if (!cancelled) stop = startUrlSync(map);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Sound effects: quiet cues at the moments that matter (the flight down, alerts, the helmet).
  useEffect(() => startSoundCues(), []);

  // The app clock follows real time, second by second, until a mission takes it over.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = useApp.getState();
      if (!s.clockPaused) s.setUtcMs(s.clockLive ? Date.now() : s.utcMs + 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const inMap = mode === 'map';

  return (
    <div className="space absolute inset-0 overflow-hidden">
      <Starfield />
      <MapView />
      <Intro />
      {/* The map chrome fades in once, after the first landing, and never waits again. */}
      <div
        className={cn(
          // The layer itself never takes the pointer: the map below must stay draggable between the panels.
          'pointer-events-none absolute inset-0 z-20 transition-opacity',
          landed ? 'duration-700' : 'duration-0',
          inMap ? 'opacity-100' : 'opacity-0',
        )}
        inert={!inMap}
      >
        <Suspense fallback={null}>
          {NetRoot ? (
            <NetRoot>
              <Chrome />
            </NetRoot>
          ) : (
            <Chrome />
          )}
        </Suspense>
      </div>
      {visorOpen ? (
        <Suspense fallback={null}>
          <RoverView />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <Toasts />
      </Suspense>
    </div>
  );
}
