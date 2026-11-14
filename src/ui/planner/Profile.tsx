import { useMemo } from 'react';
import type { PathPoint, TripResult } from '@/engines/types';
import { gradesAlong, pathStats } from '@/planner/geometry';
import { fmtDistance, fmtElevation } from '@/lib/format';

const W = 320;
const H = 64;
const PAD_TOP = 8;
const PAD_BOTTOM = 12;

interface ProfileProps {
  path: readonly PathPoint[];
  stopIndices: readonly number[];
  trip: TripResult;
  comfortDeg: number;
  blockDeg: number;
}

/**
 * The route seen from the side: height against distance, drawn in the slope colours of the route on
 * the map, with the stops and the marks that matter (the point of no return, where oxygen ends).
 */
export function Profile({ path, stopIndices, trip, comfortDeg, blockDeg }: ProfileProps) {
  const shape = useMemo(() => {
    const { along, distM } = pathStats(path);
    if (path.length < 2 || distM <= 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of path) {
      if (!Number.isFinite(p[2])) continue;
      lo = Math.min(lo, p[2]);
      hi = Math.max(hi, p[2]);
    }
    if (!Number.isFinite(lo)) return null;
    // A flat route is drawn flat, not stretched to fill the box.
    const span = Math.max(hi - lo, 40);
    const x = (i: number) => ((along[i] ?? 0) / distM) * W;
    const y = (elev: number) => PAD_TOP + (1 - (elev - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);
    const grades = gradesAlong(path, along);
    // At most a point per pixel and a half: the eye sees no more and the SVG stays small.
    const stride = Math.max(1, Math.floor(path.length / (W * 1.5)));
    const kind = (i: number) => {
      const g = Math.abs(grades[i] ?? 0);
      return g >= blockDeg ? 2 : g >= comfortDeg ? 1 : 0;
    };
    const runs: { kind: number; d: string }[] = [];
    let area = '';
    let last = -1;
    for (let i = 0; i < path.length; i += stride) {
      const p = path[i];
      if (!p) continue;
      const px = x(i).toFixed(1);
      const py = y(p[2]).toFixed(1);
      area += `${area ? 'L' : 'M'}${px} ${py}`;
      const k = kind(i);
      const run = runs[runs.length - 1];
      if (run && k === last) run.d += `L${px} ${py}`;
      else {
        // A new run starts where the last one ended, so the line has no gaps.
        const from = run ? run.d.slice(run.d.lastIndexOf('L') + 1) : `${px} ${py}`;
        runs.push({ kind: k, d: `M${from}L${px} ${py}` });
      }
      last = k;
    }
    area += `L${W} ${H}L0 ${H}Z`;
    const at = (index: number | null) => (index === null || !path[index] ? null : { x: x(index), y: y(path[index]?.[2] ?? lo) });
    return { area, runs, lo, hi, distM, stops: stopIndices.slice(1, -1).map((i) => at(i)), pnr: at(trip.pointOfNoReturnIndex), o2: at(trip.o2OutIndex), walk: at(trip.walkbackIndex) };
  }, [path, stopIndices, trip, comfortDeg, blockDeg]);

  if (!shape) return null;
  const COLOURS = ['var(--primary)', 'var(--caution)', 'var(--warning)'];
  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full overflow-visible"
        role="img"
        aria-label={`Height along the route: ${fmtDistance(shape.distM)}, from ${fmtElevation(shape.lo)} at the lowest to ${fmtElevation(shape.hi)} at the highest.`}
      >
        <path d={shape.area} fill="var(--foreground)" opacity={0.07} />
        {shape.runs.map((run, i) => (
          <path key={i} d={run.d} fill="none" stroke={COLOURS[run.kind]} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        {shape.stops.map((s, i) => (s ? <line key={i} x1={s.x} x2={s.x} y1={s.y} y2={H} stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null))}
        {shape.pnr ? <circle cx={shape.pnr.x} cy={shape.pnr.y} r={3.2} fill="none" stroke="var(--caution)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" /> : null}
        {shape.walk ? <circle cx={shape.walk.x} cy={shape.walk.y} r={3.2} fill="none" stroke="var(--caution)" strokeWidth={1.6} strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" /> : null}
        {shape.o2 ? <circle cx={shape.o2.x} cy={shape.o2.y} r={3.2} fill="var(--warning)" /> : null}
      </svg>
      <figcaption className="figure mt-1 flex justify-between text-[11px] text-faint">
        <span>{fmtElevation(shape.lo)} lowest</span>
        <span>{fmtElevation(shape.hi)} highest</span>
      </figcaption>
      {shape.pnr || shape.o2 || shape.walk ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          {shape.pnr ? (
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full border-[1.5px] border-caution" aria-hidden />
              Point of no return
            </li>
          ) : null}
          {shape.walk ? (
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full border-[1.5px] border-dashed border-caution" aria-hidden />
              Walk-home limit
            </li>
          ) : null}
          {shape.o2 ? (
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" aria-hidden />
              Oxygen runs out
            </li>
          ) : null}
        </ul>
      ) : null}
    </figure>
  );
}
