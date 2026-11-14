import { useState } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import { loadTraverse } from '@/data/datasets';
import type { PathPoint } from '@/engines/types';
import { M20_LEGS, compareTracks, legTrack, type TrackComparison, type Traverse, type TraverseLeg } from '@/engines/validate';
import { getMap } from '@/map/instance';
import { routeOnce } from '@/planner/single';
import { useApp } from '@/store';
import { fmtDistance, fmtNumber, fmtPercent } from '@/lib/format';

type LegState = { status: 'idle' } | { status: 'routing'; progress: number } | { status: 'done'; result: TrackComparison } | { status: 'failed'; message: string };

const SRC = 'validate-plan';

/** Draws the planned track over the real one, so the two can be compared by eye as well as by number. */
function showOnMap(planned: PathPoint[], real: PathPoint[]): void {
  const map = getMap();
  if (!map) return;
  const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: planned.map((p) => [p[0], p[1]]) } };
  const source = map.getSource<GeoJSONSource>(SRC);
  if (source) source.setData(data);
  else {
    map.addSource(SRC, { type: 'geojson', data });
    map.addLayer({ id: `${SRC}-casing`, type: 'line', source: SRC, paint: { 'line-color': '#0e1a25', 'line-width': 5, 'line-opacity': 0.6 } });
    map.addLayer({ id: SRC, type: 'line', source: SRC, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#9cc4ea', 'line-width': 2.6, 'line-dasharray': [2, 1.4] } });
  }
  const lons = [...planned, ...real].map((p) => p[0]);
  const lats = [...planned, ...real].map((p) => p[1]);
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: { left: 60, right: 440, top: 100, bottom: 80 }, maxZoom: 15, duration: 1500 },
  );
}

function Leg({ leg }: { leg: TraverseLeg }) {
  const [state, setState] = useState<LegState>({ status: 'idle' });

  const run = async () => {
    setState({ status: 'routing', progress: 0 });
    try {
      const traverse = (await loadTraverse()) as unknown as Traverse;
      const real = legTrack(traverse, leg);
      const first = real[0];
      const last = real[real.length - 1];
      if (!first || !last || real.length < 2) return setState({ status: 'failed', message: 'This part of the drive is not in the data.' });
      // The same two ends, routed as the rover would be: robotic, and safest.
      const reply = await routeOnce({
        from: [first[0], first[1]],
        to: [last[0], last[1]],
        vehicle: 'robotRover',
        style: 'safest',
        departUtcMs: useApp.getState().utcMs,
        onProgress: (progress) => setState({ status: 'routing', progress }),
      });
      if (!reply.ok) return setState({ status: 'failed', message: reply.message });
      showOnMap(reply.path, real);
      setState({ status: 'done', result: compareTracks(reply.path, real) });
    } catch {
      setState({ status: 'failed', message: 'The route could not be worked out. Check the connection and try again.' });
    }
  };

  return (
    <li className="rounded-md border p-3">
      <h4 className="text-[13px] font-semibold">{leg.name}</h4>
      <p className="figure mt-0.5 text-xs text-muted-foreground">
        Sols {leg.fromSol} to {leg.toSol}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">{leg.description}</p>
      {state.status === 'done' ? (
        <div className="mt-2.5 border-t pt-2.5" aria-live="polite">
          <p className="text-[13px] leading-relaxed">
            <span className="figure font-semibold">{fmtNumber(state.result.medianM)} m</span> typical distance from the real drive,{' '}
            <span className="figure font-semibold">{fmtPercent(state.result.within300Frac)}</span> of the plan within 300 m.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The plan is {fmtDistance(state.result.plannedLengthM)}, the rover drove {fmtDistance(state.result.realLengthM)}. The furthest tenth of the plan is more than {fmtNumber(state.result.p90M)} m from
            the rover’s track. The dashed line on the map is the plan.
          </p>
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {state.message}
        </p>
      ) : null}
      {state.status === 'routing' ? (
        <div className="mt-2.5" aria-live="polite">
          <p className="text-xs text-muted-foreground">Routing the same two ends…</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}>
            <div className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out" style={{ transform: `scaleX(${Math.max(0.04, state.progress)})` }} />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void run()} className="mt-2.5 inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11">
          {state.status === 'done' ? 'Route it again' : 'Route it'}
        </button>
      )}
    </li>
  );
}

/**
 * The planner checked against a rover that really drove here: for five stretches of Perseverance's
 * drive, the app routes the same two ends and measures how far its line lies from the rover's.
 */
export function ValidatePanel() {
  return (
    <div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Perseverance’s drivers picked its way across this ground with far better pictures than the app has. If the planner is any good, its route between the same two points should lie close to theirs.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {M20_LEGS.map((leg) => (
          <Leg key={leg.id} leg={leg} />
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        The rover also left the easy line on purpose: it detoured to rocks worth studying and steered round hazards the size of a wheel, which no map from orbit shows. A close match means the planner reads the
        terrain the way the drivers did; a gap does not always mean it is wrong.
      </p>
    </div>
  );
}
