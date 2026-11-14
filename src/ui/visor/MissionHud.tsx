import { Pause, Play } from 'lucide-react';
import { marsTime, sunriseSunset } from '@/engines/marsTime';
import { VEHICLES } from '@/engines/vehicles';
import { setRunSpeed, toggleRunPaused } from '@/sim/controller';
import { SPEEDS } from '@/sim/types';
import { crewAt, progress } from '@/sim/world';
import { useApp } from '@/store';
import { Alerts } from '@/ui/run/Alerts';
import { fmtClock, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CameraMode } from '@/visor';

const SHADOW = '[text-shadow:0_1px_3px_rgb(0_0_0/0.9),0_0_1px_rgb(0_0_0/0.8)]';
const CAMERAS: readonly { id: CameraMode; label: string }[] = [
  { id: 'helmet', label: 'Helmet' },
  { id: 'chase', label: 'Chase' },
  { id: 'orbit', label: 'Orbit' },
];

/** A level as an arc: thin, one tint, the number in the middle. It turns amber, then red, near the reserve. */
function Arc({ label, frac }: { label: string; frac: number | null }) {
  if (frac === null) return null;
  const f = Math.max(0, Math.min(1, frac));
  const R = 22;
  const sweep = 1.5 * Math.PI * R; // three quarters of a circle
  const colour = f < 0.2 ? 'var(--warning)' : f < 0.35 ? 'var(--caution)' : '#cfe6fb';
  return (
    <div className="flex flex-col items-center" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
      <svg viewBox="0 0 56 56" className="size-[58px] drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]" aria-hidden>
        <g transform="rotate(135 28 28)" fill="none" strokeLinecap="round" strokeWidth={3}>
          <circle cx={28} cy={28} r={R} stroke="rgb(255 255 255 / 0.28)" strokeDasharray={`${sweep} ${2 * Math.PI * R}`} />
          <circle cx={28} cy={28} r={R} stroke={colour} strokeDasharray={`${sweep * f} ${2 * Math.PI * R}`} />
        </g>
        <text x={28} y={32} textAnchor="middle" className="figure fill-white text-[13px] font-semibold">
          {Math.round(f * 100)}
        </text>
      </svg>
      <span className={cn('-mt-1 text-[11px] font-medium text-white/90', SHADOW)}>{label}</span>
    </div>
  );
}

/**
 * The helmet display for a running mission: what the crew is heading for, what they have left, the
 * hour and the light, the same alerts as on the map, and the clock and camera controls.
 */
export function MissionHud({ camera, onCamera }: { camera: CameraMode; onCamera: (mode: CameraMode) => void }) {
  const world = useApp((s) => s.world);
  const run = world?.run;
  if (!world || !run) return null;
  const crew = crewAt(run, world.utcMs);
  const prog = progress(run, world.utcMs);
  const ltst = marsTime(world.utcMs, crew.lon).ltstH;
  const toSunset = (sunriseSunset(world.utcMs, crew.lat, crew.lon).setUtcMs - world.utcMs) / 1000;
  const v = VEHICLES[run.vehicle];
  const doing = run.tasks.find((t) => t.state === 'doing');
  const over = run.status !== 'running';
  const line = over
    ? (run.outcome?.text ?? 'Mission over')
    : crew.state === 'work'
      ? `${doing?.label ?? 'Working'} at ${doing?.stopName ?? prog.nextName}`
      : crew.state === 'wait'
        ? 'Waiting for daylight'
        : crew.state === 'camp'
          ? 'Camped for the night'
          : `${prog.nextName}, ${fmtDistance(prog.nextDistM)}, ${fmtDuration(prog.nextS)}`;

  return (
    <>
      <Alerts inVisor />

      <div className={cn('pointer-events-none absolute top-16 right-4 max-w-[min(20rem,60vw)] text-right text-white', SHADOW)} aria-live="polite">
        <p className="text-[11px] font-medium text-white/75">{over ? 'Result' : crew.state === 'move' ? 'Next' : 'Now'}</p>
        <p className="text-[15px] leading-snug font-semibold">{line}</p>
        <p className="figure mt-1 text-xs text-white/85">
          {fmtClock(ltst)} LTST{toSunset > 0 && toSunset < 14 * 3600 ? `, sunset in ${fmtDuration(toSunset)}` : ''}
        </p>
        <p className="figure text-xs text-white/85">
          Tasks {prog.tasksDone} of {prog.tasksTotal}, dose {fmtNumber(crew.doseMSv, 2)} mSv
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 flex items-end gap-3">
        <Arc label="Oxygen" frac={crew.o2Frac} />
        <Arc label="Battery" frac={crew.batteryFrac} />
        {crew.o2Frac === null && crew.batteryFrac === null ? <span className={cn('text-xs text-white/85', SHADOW)}>{v.name}</span> : null}
        <span className="sr-only">
          {crew.o2Frac !== null ? `Oxygen ${fmtPercent(crew.o2Frac)}. ` : ''}
          {crew.batteryFrac !== null ? `Battery ${fmtPercent(crew.batteryFrac)}.` : ''}
        </span>
      </div>

      <div className="pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 flex max-w-[calc(100vw-10.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2">
        <div role="radiogroup" aria-label="Camera" className="panel flex gap-0.5 p-0.5">
          {CAMERAS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={camera === c.id}
              onClick={() => onCamera(c.id)}
              className={cn('h-9 rounded-md px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-11', camera === c.id ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}
            >
              {c.label}
            </button>
          ))}
        </div>
        {over ? null : (
          <div className="panel flex items-center gap-0.5 p-0.5">
            <div role="radiogroup" aria-label="Speed" className="flex gap-0.5">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="radio"
                  aria-checked={world.speed === speed}
                  onClick={() => setRunSpeed(speed)}
                  className={cn('figure h-9 min-w-9 rounded-md px-1.5 text-xs font-semibold transition-colors pointer-coarse:h-11 pointer-coarse:min-w-10', world.speed === speed ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary')}
                >
                  {speed}×
                </button>
              ))}
            </div>
            <button type="button" aria-label={world.paused ? 'Resume the mission' : 'Pause the mission'} onClick={toggleRunPaused} className="grid size-9 place-items-center rounded-md transition-colors hover:bg-secondary pointer-coarse:size-11">
              {world.paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
