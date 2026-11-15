import { Pause, Play, RotateCcw } from 'lucide-react';
import type { CameraMode } from '@/visor';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { REPLAY_BASE_MS, REPLAY_SPEEDS, useReplay } from './replayFeed';

const CAMERAS: readonly { id: CameraMode; label: string }[] = [
  { id: 'chase', label: 'Behind' },
  { id: 'orbit', label: 'Around' },
  { id: 'helmet', label: 'Mast' },
];

const SEG = 'h-8 rounded px-2 text-xs font-semibold transition-colors pointer-coarse:h-10';

/** Riding Perseverance's drive: where it has got to, how fast the replay runs, and the camera. */
export function ReplayBar({ camera, onCamera }: { camera: CameraMode; onCamera: (mode: CameraMode) => void }) {
  const { distM, totalM, sol, speed, playing } = useReplay();
  const done = totalM > 0 && distM >= totalM - 1;
  const frac = totalM > 0 ? distM / totalM : 0;
  return (
    <section aria-label="Perseverance's drive" className="panel w-[min(22rem,calc(100vw-1.5rem))] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-semibold">Perseverance’s drive</h2>
        <span className="figure text-xs text-muted-foreground">
          Sol {sol} · {fmtNumber(distM / 1000, 2)} of {fmtNumber(totalM / 1000, 1)} km
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary" role="progressbar" aria-label="Along the drive" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${frac})` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={done ? 'Replay from the start' : playing ? 'Pause' : 'Play'}
          onClick={() => (done ? useReplay.setState({ distM: 0, playing: true }) : useReplay.setState({ playing: !playing }))}
          className="grid size-8 place-items-center rounded-md border transition-colors hover:bg-secondary pointer-coarse:size-10"
        >
          {done ? <RotateCcw className="size-4" aria-hidden /> : playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <div role="radiogroup" aria-label="Speed" className="flex gap-0.5 rounded-md border p-0.5">
          {REPLAY_SPEEDS.map((sp) => (
            <button
              key={sp}
              type="button"
              role="radio"
              aria-checked={speed === sp}
              title={`${REPLAY_BASE_MS * sp} m/s`}
              onClick={() => useReplay.setState({ speed: sp })}
              className={cn(SEG, 'figure min-w-9', speed === sp ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary')}
            >
              {sp}×
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Camera" className="flex gap-0.5 rounded-md border p-0.5">
          {CAMERAS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={camera === c.id} onClick={() => onCamera(c.id)} className={cn(SEG, camera === c.id ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary')}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">The track is NASA’s; the ride is sped up. Ground ahead loads as it comes, sharper the slower you go.</p>
    </section>
  );
}
