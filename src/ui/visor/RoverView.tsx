import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '@/store';
import { nextLtst, marsTime, sunriseSunset } from '@/engines/marsTime';
import { fmtClock, fmtDeg, fmtDuration, fmtElevation, fmtLatLon } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { MissionFeed, VisorHandle, VisorState } from '@/visor';
import { ReplayBar } from './ReplayBar';
import { useIsTouch } from '@/ui/hooks/useMediaQuery';
import { MovePad } from './MovePad';
import { missionFeed } from './missionFeed';
import { MissionHud } from './MissionHud';
import { RoamBar } from './RoamBar';
import { propCaption, sceneProps, standpoint } from './scene';
import { returnToMap } from '@/map/descend';

const TIMES: readonly { label: string; hour: number }[] = [
  { label: 'Morning', hour: 8.5 },
  { label: 'Noon', hour: 12 },
  { label: 'Afternoon', hour: 15 },
  { label: 'Dusk', hour: 17.6 },
];

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A strip of compass bearings that slides with the view. */
function CompassTape({ heading }: { heading: number }) {
  const PX_PER_DEG = 4;
  const marks: { deg: number; label: string; major: boolean }[] = [];
  for (let d = -90; d <= 90; d += 15) {
    const deg = Math.round((heading + d) / 15) * 15;
    const norm = ((deg % 360) + 360) % 360;
    marks.push({ deg, label: norm % 45 === 0 ? (POINTS[norm / 45] ?? '') : String(norm), major: norm % 45 === 0 });
  }
  return (
    <div className="relative h-9 w-[min(560px,60vw)] overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)]" aria-hidden>
      {marks.map((m) => (
        <span
          key={m.deg}
          className={cn('figure absolute top-0 flex -translate-x-1/2 flex-col items-center text-[11px]', m.major ? 'font-semibold text-white' : 'text-white/70')}
          style={{ left: `calc(50% + ${(m.deg - heading) * PX_PER_DEG}px)` }}
        >
          <span className={cn('mb-1 block w-px bg-current', m.major ? 'h-2.5' : 'h-1.5')} />
          {m.label}
        </span>
      ))}
      <span className="absolute top-0 left-1/2 h-3 w-0.5 -translate-x-1/2 bg-primary" />
    </div>
  );
}

/** Everything the overlay shows of the view's state, as one string to compare. */
function shownKey(s: VisorState): string {
  return `${s.ready}|${s.loading}|${s.lon.toFixed(5)}|${s.lat.toFixed(5)}|${Math.round(s.elev)}|${s.slopeDeg.toFixed(1)}|${Math.round(s.headingDeg)}|${s.groundSource}|${s.near}|${s.camera}|${s.roam.vehicle}|${s.roam.view}`;
}

const SHADOW = '[text-shadow:0_1px_3px_rgb(0_0_0/0.9),0_0_1px_rgb(0_0_0/0.8)]';

/** The ground at eye level: your own eyes, no crew and no route. */
export default function RoverView() {
  const at = useApp((s) => s.visor);
  const closeVisor = useApp((s) => s.closeVisor);
  const minute = useApp((s) => Math.floor(s.utcMs / 60_000));
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<VisorHandle | null>(null);
  const [state, setState] = useState<VisorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the browser takes the graphics away for good: a fresh canvas and a fresh view.
  const [attempt, setAttempt] = useState(0);
  const touch = useIsTouch();
  // Riding along only when asked for, and only while the mission runs; anywhere else the visitor stands on foot.
  const ride = at?.ride === true;
  const replaySol = at?.replaySol;
  const replaying = replaySol !== undefined;
  // Set when the graphics were lost and the view restarts itself; the clock saved at first opening carries over.
  const restarting = useRef(false);
  const saved = useRef<{ utcMs: number; live: boolean; paused: boolean } | null>(null);
  const riding = useApp((s) => ride && s.world?.run?.status === 'running');
  const lon = at?.lon;
  const lat = at?.lat;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || lon === undefined || lat === undefined) return;
    // A canvas of its own for every start: a closed view gives its context back to the browser, and a
    // context once given back cannot be had again from the same canvas (React starts effects twice in
    // development, and a lost context is rebuilt from scratch).
    const canvas = document.createElement('canvas');
    canvas.className = 'block size-full touch-none';
    host.appendChild(canvas);
    let cancelled = false;
    const app = useApp.getState();
    // Riding along with a mission: the mission owns the clock, and the view follows the crew.
    const mission = ride ? missionFeed() : null;
    // Otherwise the clock is restored when the view closes. A restart after the graphics were lost keeps the
    // clock as it was first found, and the hour the visitor picked since.
    const restart = restarting.current;
    restarting.current = false;
    if (!restart || !saved.current) saved.current = { utcMs: app.utcMs, live: app.clockLive, paused: app.clockPaused };
    // A dark spot opens at mid-morning: there is nothing to see at night.
    const t = marsTime(app.utcMs, lon);
    if (!mission && !restart && (t.ltstH < 6.5 || t.ltstH > 17.8)) {
      app.setClock(nextLtst(app.utcMs, lon, 10), false);
      app.setClockPaused(true);
    }
    // Replaying Perseverance's drive: the rover's own track is the feed.
    const feed: Promise<MissionFeed | null> = replaySol !== undefined ? import('./replayFeed').then((m) => m.replayFeed(replaySol)) : Promise.resolve(mission);
    // The scene’s rovers and base are worked out first, so the view can open beside one, not inside it.
    void Promise.all([import('@/visor'), sceneProps(app.world?.run?.plan ?? app.plan, app.world?.run?.vehicle ?? null), feed])
      .then(async ([{ mountVisor }, sceneList, follow]) => {
        // On a replay Perseverance is the one driving: its parked copy stays out of the scene.
        const props = replaySol !== undefined ? sceneList.filter((p) => p.id !== 'perseverance') : sceneList;
        const mission = follow;
        const stand = mission ? { lon, lat, headingDeg: 0 } : standpoint(lon, lat, props);
        const handle = await mountVisor(canvas, {
          ...(mission ? { mission } : {}),
          lon: stand.lon,
          lat: stand.lat,
          headingDeg: stand.headingDeg,
          utcMs: () => useApp.getState().utcMs,
          scenario: () => useApp.getState().scenario,
          props,
          // Read once per opening, from the store: the arrival only shapes how the view starts.
          ...(app.visor?.arrive && !mission ? { arrive: app.visor.arrive } : {}),
          walkers: () => useApp.getState().walkers,
          onAscend: () => {
            if (cancelled) return;
            // Back up to the map, over the spot the view had walked to, facing the same way.
            const s = handleRef.current?.getState();
            useApp.getState().closeVisor();
            if (s) returnToMap(s.lon, s.lat, s.headingDeg);
          },
          onLost: () => {
            if (cancelled) return;
            restarting.current = true;
            setAttempt((n) => n + 1);
          },
          onState: (next) => {
            if (cancelled) return;
            // The view reports five times a second; redraw the overlay only when something it shows has changed.
            setState((prev) => (prev && shownKey(prev) === shownKey(next) ? prev : next));
          },
        });
        return handle;
      })
      .then((handle) => {
        if (cancelled) return handle.dispose();
        handleRef.current = handle;
        window.__areoVisor = handle;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.name === 'WebGLUnavailableError' ? err.message : 'The 3D view could not start.');
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
      canvas.remove();
      delete window.__areoVisor;
      if (mission || restarting.current || !saved.current) return;
      const was = saved.current;
      saved.current = null;
      const now = useApp.getState();
      now.setClock(was.live ? Date.now() : was.utcMs, was.live);
      now.setClockPaused(was.paused);
    };
  }, [lon, lat, ride, replaySol, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeVisor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeVisor]);

  if (!at) return null;
  const utcMs = minute * 60_000;
  const viewLon = state?.lon ?? at.lon;
  const viewLat = state?.lat ?? at.lat;
  const time = marsTime(utcMs, viewLon);
  const sun = sunriseSunset(utcMs, viewLat, viewLon);
  const toSunset = (sun.setUtcMs - utcMs) / 1000;

  const setTime = (hour: number) => {
    const app = useApp.getState();
    app.setClock(nextLtst(app.utcMs, viewLon, hour), false);
    app.setClockPaused(true);
  };

  return (
    <div className="absolute inset-0 z-40 bg-black" role="region" aria-label="Rover View">
      <div ref={hostRef} className="size-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <button
          type="button"
          onClick={closeVisor}
          aria-label="Back to the map"
          className="panel pointer-events-auto inline-flex h-10 items-center gap-2 px-3 text-sm font-medium hover:bg-secondary max-md:size-11 max-md:justify-center max-md:px-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="max-md:hidden">Back to the map</span>
        </button>
        <div className={cn('absolute top-3 left-1/2 -translate-x-1/2', SHADOW)}>{state ? <CompassTape heading={state.headingDeg} /> : null}</div>
      </div>

      {state?.ready ? (
        <>
          {riding ? <MissionHud camera={state.camera} onCamera={(mode) => handleRef.current?.setCamera(mode)} /> : null}
          {replaying ? (
            <div className={cn('pointer-events-auto absolute right-3', touch ? 'top-[7.5rem]' : 'top-3')}>
              <ReplayBar camera={state.camera} onCamera={(mode) => handleRef.current?.setCamera(mode)} />
            </div>
          ) : null}
          {riding || replaying ? null : (
            <div className={cn('pointer-events-auto absolute right-3', touch ? 'top-[7.5rem]' : 'top-3')}>
              <RoamBar vehicle={state.roam.vehicle} view={state.roam.view} onChange={(v, view) => handleRef.current?.setRoam(v, view)} />
            </div>
          )}
          {touch && !riding && !replaying ? (
            <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-5">
              <MovePad onMove={(right, forward, fast) => handleRef.current?.setMove(right, forward, fast)} />
            </div>
          ) : null}

          <dl
            className={cn(
              'figure pointer-events-none absolute grid gap-1 text-[12.5px] leading-tight font-medium text-white/95',
              riding ? 'top-16 left-4 max-w-[260px] max-md:hidden' : touch ? 'right-3 bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[152px] text-[11.5px]' : 'bottom-4 left-4 max-w-[300px]',
              SHADOW,
            )}
          >
            {riding ? null : (
              <>
                <div>{fmtLatLon(state.lat, state.lon)}</div>
                <div>
                  {fmtElevation(state.elev)}, slope {fmtDeg(state.slopeDeg, state.slopeDeg < 10 ? 1 : 0)}, heading {fmtDeg(state.headingDeg)}
                </div>
                <div>
                  {fmtClock(time.ltstH)} LTST{toSunset > 0 && toSunset < 14 * 3600 ? `, sunset in ${fmtDuration(toSunset)}` : ''}
                </div>
              </>
            )}
            <div className="font-sans text-white/75">
              Ground from the {state.groundSource}. Rocks and fine texture are drawn in, not measured.{riding ? ' The crew and its route are simulated.' : ''}
            </div>
            {state.near && !riding ? <div className="font-sans text-white/75">{propCaption(state.near)}</div> : null}
          </dl>

          <div className={cn('pointer-events-auto absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2', touch ? 'top-[4.25rem]' : 'bottom-4', riding && 'hidden')}>
            <div role="radiogroup" aria-label="Time of day" className="panel flex gap-0.5 p-0.5">
              {TIMES.map((t) => {
                const checked = Math.abs(time.ltstH - t.hour) < 0.1;
                return (
                  <button
                    key={t.label}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setTime(t.hour)}
                    className={cn('h-9 rounded-md px-3 text-[13px] font-medium transition-colors pointer-coarse:h-11', checked ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {touch ? null : (
              <p className={cn('text-xs text-white/80', SHADOW)}>
                {replaying
                  ? 'Drag to look around. The rover follows its real track; pause or change the speed in the panel.'
                  : state.roam.vehicle === 'foot' && state.roam.view === 'eyes'
                  ? 'W A S D or the arrow keys to walk, Shift to hurry. Drag to look. Scroll to rise, and past the top to return to the map.'
                  : 'W and S to go and stop, A and D to steer, Shift for more speed. Drag to look around. Scroll to bring the camera in or out.'}
              </p>
            )}
          </div>
        </>
      ) : null}

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="panel max-w-sm p-5 text-center">
            <p className="text-[15px] font-semibold">The 3D view is not available</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error} The map and the planner work without it.</p>
            <button type="button" onClick={closeVisor} className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground">
              Back to the map
            </button>
          </div>
        </div>
      ) : !state?.ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-live="polite">
          <p className={cn('text-sm font-medium text-white/90', SHADOW)}>{state?.loading ?? 'Building the ground from orbital data…'}</p>
        </div>
      ) : state.loading ? (
        <p className={cn('pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 text-sm font-medium text-white/90', SHADOW)}>{state.loading}</p>
      ) : null}
    </div>
  );
}

declare global {
  interface Window {
    /** The running 3D view, for the tests and the demo console. */
    __areoVisor?: VisorHandle;
  }
}
