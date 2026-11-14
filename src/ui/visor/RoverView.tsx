import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '@/store';
import { nextLtst, marsTime, sunriseSunset } from '@/engines/marsTime';
import { fmtClock, fmtDeg, fmtDuration, fmtElevation, fmtLatLon } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { VisorHandle, VisorState } from '@/visor';
import { propCaption, sceneProps, standpoint } from './scene';

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
    <div className="relative h-9 w-[min(560px,70vw)] overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_18%,black_82%,transparent)]" aria-hidden>
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

const SHADOW = '[text-shadow:0_1px_3px_rgb(0_0_0/0.9),0_0_1px_rgb(0_0_0/0.8)]';

/** The ground at eye level: your own eyes, no crew and no route. */
export default function RoverView() {
  const at = useApp((s) => s.visor);
  const closeVisor = useApp((s) => s.closeVisor);
  const minute = useApp((s) => Math.floor(s.utcMs / 60_000));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<VisorHandle | null>(null);
  const [state, setState] = useState<VisorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The thing the viewer is standing near, if any. */
  const [nearId, setNearId] = useState<string | null>(null);
  const lon = at?.lon;
  const lat = at?.lat;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || lon === undefined || lat === undefined) return;
    let cancelled = false;
    const app = useApp.getState();
    // The clock is restored when the view closes.
    const saved = { utcMs: app.utcMs, live: app.clockLive, paused: app.clockPaused };
    // A dark spot opens at mid-morning: there is nothing to see at night.
    const t = marsTime(app.utcMs, lon);
    if (t.ltstH < 6.5 || t.ltstH > 17.8) {
      app.setClock(nextLtst(app.utcMs, lon, 10), false);
      app.setClockPaused(true);
    }
    // The scene's rovers and base are worked out first, so the view can open beside one, not inside it.
    void Promise.all([import('@/visor'), sceneProps(app.plan)])
      .then(async ([{ mountVisor }, props]) => {
        const stand = standpoint(lon, lat, props);
        const handle = await mountVisor(canvas, {
          lon: stand.lon,
          lat: stand.lat,
          headingDeg: stand.headingDeg,
          utcMs: () => useApp.getState().utcMs,
          scenario: () => useApp.getState().scenario,
          onState: (s) => {
            if (cancelled) return;
            setState(s);
            const handle = handleRef.current;
            if (!handle) return;
            const me = handle.position();
            let best: { id: string; d: number } | null = null;
            for (const p of handle.props()) {
              const d = Math.hypot(p.x - me.x, p.z - me.z);
              if (p.seated && d < 60 && (!best || d < best.d)) best = { id: p.id, d };
            }
            setNearId(best?.id ?? null);
          },
        });
        handle.setProps(props);
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
      delete window.__areoVisor;
      const now = useApp.getState();
      now.setClock(saved.live ? Date.now() : saved.utcMs, saved.live);
      now.setClockPaused(saved.paused);
    };
  }, [lon, lat]);

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
      <canvas ref={canvasRef} className="size-full touch-none" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <button
          type="button"
          onClick={closeVisor}
          className="panel pointer-events-auto inline-flex h-10 items-center gap-2 px-3 text-sm font-medium hover:bg-secondary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the map
        </button>
        <div className={cn('absolute top-3 left-1/2 -translate-x-1/2', SHADOW)}>{state ? <CompassTape heading={state.headingDeg} /> : null}</div>
      </div>

      {state?.ready ? (
        <>
          <dl className={cn('figure pointer-events-none absolute bottom-4 left-4 grid max-w-[300px] gap-1 text-[12.5px] leading-tight font-medium text-white/95', SHADOW)}>
            <div>{fmtLatLon(state.lat, state.lon)}</div>
            <div>
              {fmtElevation(state.elev)}, slope {fmtDeg(state.slopeDeg, state.slopeDeg < 10 ? 1 : 0)}, heading {fmtDeg(state.headingDeg)}
            </div>
            <div>
              {fmtClock(time.ltstH)} LTST{toSunset > 0 && toSunset < 14 * 3600 ? `, sunset in ${fmtDuration(toSunset)}` : ''}
            </div>
            <div className="font-sans text-white/75">Ground from the {state.groundSource}. Rocks and fine texture are drawn in, not measured.</div>
            {nearId ? <div className="font-sans text-white/75">{propCaption(nearId)}</div> : null}
          </dl>

          <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
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
                    className={cn('h-9 rounded-md px-3 text-[13px] font-medium transition-colors', checked ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className={cn('hidden text-xs text-white/80 md:block', SHADOW)}>W A S D or the arrow keys to walk. Hold Shift to go at rover speed. Drag to look. Esc to leave.</p>
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
          <p className={cn('text-sm font-medium text-white/90', SHADOW)}>{state?.loading ?? 'Building the ground from orbital data'}</p>
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
