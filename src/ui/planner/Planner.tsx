import { lazy, Suspense } from 'react';
import { House, MousePointerClick, Move, Plus, TriangleAlert, X, Plane, Play } from 'lucide-react';
import { flySelectedRoute } from '@/map/flyover';
import { getMap } from '@/map/instance';
import { startMission } from '@/sim/controller';
import { Budget } from './Budget';
import { Departure } from './Departure';
import { Exports } from './Exports';
import { toast } from 'sonner';
import type { RouteAlternative } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { useApp, type RouteState } from '@/store';
import { fmtClock, fmtDeg, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from '@/lib/format';
import { marsTime } from '@/engines/marsTime';
import { cn } from '@/lib/cn';
import { StopList } from './StopList';
import { stopLabel } from '@/planner/labels';
import { planLocked, useCrew } from '@/net/state';
import { NET_ENABLED } from '@/net/config';
import { startsAtBase, withBase } from '@/planner/base';
import { useIsPhone } from '@/ui/hooks/useMediaQuery';
import { FleetPicker } from './FleetPicker';
import { fleetOf, peopleOf } from '@/engines/fleet';
import { startProblem } from '@/planner/startCheck';

// Who goes: loaded with the crew code, only when there is a crew server.
const PlannerCrew = lazy(() => import('@/ui/crew/PlannerCrew'));
const JoinList = lazy(() => import('@/ui/crew/JoinList'));

export function PickButton({ target, children }: { target: 'base' | 'stop'; children: React.ReactNode }) {
  const picking = useApp((s) => s.picking);
  const setPicking = useApp((s) => s.setPicking);
  const active = picking === target;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setPicking(active ? null : target)}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors',
        active ? 'border-primary/60 bg-primary/15 text-foreground' : 'text-foreground/90 hover:bg-secondary',
      )}
    >
      {active ? <MousePointerClick className="size-3.5 text-primary" aria-hidden /> : target === 'base' ? <Move className="size-3.5 text-muted-foreground" aria-hidden /> : <Plus className="size-3.5 text-muted-foreground" aria-hidden />}
      {active ? 'Click the map' : children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="figure mt-0.5 text-[17px] leading-tight font-medium [font-stretch:92%]">{value}</dd>
    </div>
  );
}

function AlternativeCard({ alt, selected, hasBudget, onSelect }: { alt: RouteAlternative; selected: boolean; hasBudget: boolean; onSelect: () => void }) {
  const t = alt.trip.totals;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
        selected ? 'border-primary/60 bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span className={cn('size-3 shrink-0 rounded-full border-2', selected ? 'border-primary bg-primary' : 'border-muted-foreground')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{alt.label}</span>
        <span className="figure block text-xs text-muted-foreground">
          {hasBudget ? `${fmtDuration(t.durationS)}, ` : ''}
          {fmtDistance(t.distM)}, {fmtNumber(t.climbM)} m of climb
        </span>
      </span>
      {alt.badges.length > 0 ? (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {alt.badges.map((b) => (
            <span key={b} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground/85">
              {b}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

/** The mission in one block before it starts: who goes, in what, when they leave and come back, and the margin. */
function ReadySummary({ alt, departUtcMs }: { alt: RouteAlternative; departUtcMs: number }) {
  const plan = useApp((s) => s.plan);
  const fleet = fleetOf(plan);
  const people = peopleOf(plan);
  const t = alt.trip.totals;
  const lon = plan.start?.lon ?? 77.44;
  const leave = fmtClock(marsTime(departUtcMs, lon).ltstH);
  const back = fmtClock(marsTime(departUtcMs + t.durationS * 1000, lon).ltstH);
  const tasks = plan.stops.reduce((n, st) => n + st.tasks.length, 0);
  const what = fleet.length === 0 ? 'on foot' : fleet.map((f) => `${f.count} ${VEHICLES[f.vehicle].name.toLowerCase()}${f.count > 1 ? 's' : ''}`).join(', ');
  const who = people === 0 ? 'No one aboard' : people === 1 ? 'One person' : `${people} people`;
  const rows: [string, string][] = [
    ['Who', `${who}, ${what}`],
    ['When', `Leave ${leave}, back ${back} LTST (${fmtDuration(t.durationS)})`],
    ['Where', `${fmtDistance(t.distM)} out and back: ${plan.stops.length} ${plan.stops.length === 1 ? 'stop' : 'stops'} and ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`],
  ];
  if (t.minO2Frac !== null) rows.push(['Margin', `${fmtPercent(t.minO2Frac)} of the oxygen left at the end`]);
  else if (t.minBatteryFrac !== null) rows.push(['Margin', `Battery never below ${fmtPercent(t.minBatteryFrac)}`]);
  return (
    <dl className={cn('mt-4 grid grid-cols-[4.25rem_1fr] gap-x-2 gap-y-1 rounded-md border px-3 py-2.5 text-[13px]', alt.trip.feasible ? 'border-border' : 'border-warning/50 bg-warning/5')}>
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="figure min-w-0">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plan with no route: why, and the one change that fixes it when there is one. */
function RouteFailed({ route }: { route: Extract<RouteState, { status: 'failed' }> }) {
  const plan = useApp((s) => s.plan);
  const { nearest, leg, point } = route;
  // The point at fault: the start (first, and last on a round trip), or a stop.
  const atStart = point !== undefined && (point === 0 || point === plan.stops.length + 1);
  const stop = point !== undefined && !atStart ? plan.stops[point - 1] : undefined;
  const air = VEHICLES[plan.vehicle].kind === 'air';
  let fix: { label: string; apply: () => void } | null = null;
  if (nearest && atStart && plan.start) {
    const from = plan.start.name ?? 'the start';
    fix = {
      label: air ? 'Take off from the nearest landing spot' : 'Start from the nearest reachable spot',
      apply: () => useApp.getState().setStart({ lon: nearest[0], lat: nearest[1], name: air ? `Pad by ${from}` : `Near ${from}` }),
    };
  } else if (nearest && stop) {
    fix = {
      label: `Move ${stopLabel(stop)} to the nearest ${air ? 'landing spot' : 'reachable spot'}`,
      apply: () => useApp.getState().updateStop(stop.id, { lon: nearest[0], lat: nearest[1] }),
    };
  }
  return (
    <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3">
      <p className="flex items-start gap-2 text-[13px] leading-relaxed">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-medium">Leg {leg + 1} has no route.</span> {route.message}
        </span>
      </p>
      {fix ? (
        <button type="button" onClick={fix.apply} className="mt-2 ml-6 inline-flex h-8 max-w-[calc(100%-1.5rem)] items-center rounded-md border px-2.5 text-left text-[13px] font-medium hover:bg-secondary">
          <span className="truncate">{fix.label}</span>
        </button>
      ) : null}
    </div>
  );
}

function RouteResult() {
  const route = useApp((s) => s.route);
  const selectRoute = useApp((s) => s.selectRoute);
  const vehicle = useApp((s) => VEHICLES[s.plan.vehicle]);
  const stopCount = useApp((s) => s.plan.stops.length);
  const hasStart = useApp((s) => s.plan.start !== null);
  const missionRunning = useApp((s) => s.world?.run?.status === 'running');
  // In a crew mission only the commander starts the run, and it starts for everyone.
  const locked = useCrew(planLocked);
  const crewStart = useCrew((s) => s.start);
  const problem = useApp(startProblem);

  if (route.status === 'idle') {
    return (
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {!hasStart ? 'Choose where the mission starts.' : stopCount === 0 ? 'Add a stop and a route appears here.' : ''}
      </p>
    );
  }
  if (route.status === 'routing') {
    return (
      <div aria-live="polite">
        <p className="text-[13px] text-muted-foreground">Working out the route over the terrain…</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(route.progress * 100)}>
          <div className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out" style={{ transform: `scaleX(${Math.max(0.04, route.progress)})` }} />
        </div>
      </div>
    );
  }
  if (route.status === 'failed') {
    return <RouteFailed route={route} />;
  }

  const chosen = route.alternatives.find((a) => a.id === route.selected) ?? route.alternatives[0];
  if (!chosen) return null;
  const t = chosen.trip.totals;
  const steep = t.maxGradeDeg >= vehicle.comfortSlopeDeg;
  return (
    <div>
      {route.alternatives.length > 1 ? (
        <div role="radiogroup" aria-label="Routes" className="mb-3 flex flex-col gap-1.5">
          {route.alternatives.map((alt) => (
            <AlternativeCard key={alt.id} alt={alt} selected={alt.id === chosen.id} hasBudget={route.hasBudget} onSelect={() => selectRoute(alt.id)} />
          ))}
        </div>
      ) : (
        <p className="mb-3 text-[13px] text-muted-foreground">{chosen.label}.</p>
      )}
      {route.hasBudget ? (
        <>
          <fieldset disabled={locked} className="min-w-0 disabled:[&_button]:opacity-60">
            <Departure departUtcMs={route.departUtcMs} moved={route.departMoved} lon={chosen.path[0]?.[0] ?? 0} vehicle={vehicle} />
          </fieldset>
          <Budget alt={chosen} vehicle={vehicle} />
        </>
      ) : (
        <>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
          {route.hasBudget ? <Fact label="Time" value={fmtDuration(t.durationS)} /> : null}
          <Fact label="Distance" value={fmtDistance(t.distM)} />
          <Fact label="Climb" value={`${fmtNumber(t.climbM)} m`} />
          <Fact label="Steepest" value={fmtDeg(t.maxGradeDeg, 1)} />
        </dl>
        {steep ? (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-caution">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="text-foreground/85">
              Part of this route is steeper than is comfortable {vehicle.kind === 'walk' ? 'on foot' : `for the ${vehicle.name.toLowerCase()}`} (
              {fmtDeg(vehicle.comfortSlopeDeg)}). Those stretches are drawn in amber and red.
            </span>
          </p>
        ) : null}
        </>
      )}
      {route.hasBudget && !missionRunning ? <ReadySummary alt={chosen} departUtcMs={route.departUtcMs} /> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {route.hasBudget && !missionRunning && !locked ? (
          <button
            type="button"
            // A plan that runs out of air, battery or daylight is not flown: the crew would not come back.
            disabled={problem !== null}
            onClick={() => (crewStart ? void crewStart() : startMission())}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11"
          >
            <Play className="size-4" aria-hidden />
            Start the mission
          </button>
        ) : null}
        <button
          type="button"
          onClick={flySelectedRoute}
          title="Fly the camera along the route"
          className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11"
        >
          <Plane className="size-4 text-muted-foreground" aria-hidden />
          Fly over
        </button>
        <Exports alt={chosen} hasBudget={route.hasBudget} />
      </div>
      {route.hasBudget && !missionRunning && !locked && problem ? <p aria-live="polite" className="mt-2 text-xs leading-relaxed text-muted-foreground">{problem}</p> : null}
      {!route.hasBudget ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The route follows the real terrain at {fmtNumber(route.cellM)} m detail. The trip budget did not load, so there is no time, oxygen, power or radiation for it.
        </p>
      ) : null}
    </div>
  );
}

/** The mission plan: vehicle, start, stops with their tasks, and the route that connects them. */
export function Planner() {
  const start = useApp((s) => s.plan.start);
  const stops = useApp((s) => s.plan.stops);
  const base = useApp((s) => s.base);
  const phone = useIsPhone();
  const onCrewMission = useCrew((s) => s.current !== null);
  const running = useApp((s) => s.world?.run?.status === 'running');
  const atMyBase = start !== null && startsAtBase({ start, stops, roundTrip: true, vehicle: 'foot', style: 'safest', campAtNight: false }, base);
  const openPlanner = useApp((s) => s.openPlanner);
  const clearPlan = useApp((s) => s.clearPlan);
  const locked = useCrew(planLocked);
  const tasks = stops.reduce((n, s) => n + s.tasks.length, 0);
  const work = stops.reduce((n, s) => n + s.tasks.reduce((m, t) => m + t.minutes, 0), 0);

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden" aria-label="Mission plan">
      <header className="flex h-12 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em]">Mission plan</h2>
        <button
          type="button"
          aria-label="Close the mission plan"
          onClick={() => openPlanner(false)}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {locked ? (
          <p role="note" className="border-b bg-secondary/60 px-4 py-2 text-xs text-muted-foreground">
            The commander plans the route. You see it as they change it.
          </p>
        ) : null}
        {/* A disabled fieldset disables every control inside it, so a crew member can read the plan but not change it. */}
        <fieldset disabled={locked} className="min-w-0 disabled:[&_button]:opacity-60">
        <div className="px-4 pt-3.5">
          <FleetPicker />
        </div>
        </fieldset>
        {NET_ENABLED && !running ? (
          <Suspense fallback={null}>
            <PlannerCrew />
          </Suspense>
        ) : null}
        <fieldset disabled={locked} className="min-w-0 disabled:[&_button]:opacity-60">

        <div className="px-4 pt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">From and back to</h3>
          </div>
          <div className="flex items-center gap-1 rounded-md border p-1">
            <button
              type="button"
              onClick={() => {
                const at = atMyBase || !start ? base : start;
                getMap()?.flyTo({ center: [at.lon, at.lat], zoom: Math.max(getMap()?.getZoom() ?? 0, 14.5), duration: 1200 });
              }}
              title="Show it on the map"
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left transition-colors hover:bg-secondary"
            >
              <House className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{atMyBase || !start ? base.name : stopLabel(start)}</span>
            </button>
            {!atMyBase && !running && !onCrewMission ? (
              <button type="button" onClick={() => useApp.getState().setPlan(withBase(useApp.getState().plan, base), useApp.getState().missionId ?? undefined)} className="inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[13px] font-medium hover:bg-secondary">
                Use {base.name}
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {atMyBase
              ? 'Every mission leaves the base and comes back to it.'
              : onCrewMission
                ? 'The commander’s base: the crew leaves from it and comes back to it.'
                : 'A forward station: drones and robots work from where they are kept, and come back to it.'}
          </p>
        </div>

        <div className="px-4 pt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">Stops</h3>
            {stops.length > 0 ? (
              <span className="figure text-xs text-muted-foreground">
                {stops.length} {stops.length === 1 ? 'stop' : 'stops'}, {tasks} {tasks === 1 ? 'task' : 'tasks'}
                {work > 0 ? `, ${fmtDuration(work * 60)} of work` : ''}
              </span>
            ) : null}
          </div>
          <StopList />
          <div className={cn('flex flex-wrap items-center gap-2', stops.length > 0 && 'mt-2')}>
            <PickButton target="stop">Add a stop</PickButton>
            <span className="text-xs text-muted-foreground">
              {stops.length === 0 ? 'or search for a place and choose Add stop.' : 'or click the route to add one along the way. Drag a pin to move it.'}
            </span>
          </div>
        </div>
        </fieldset>

        <div className="mt-4 border-t px-4 py-4">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Route</h3>
          <RouteResult />
        </div>
        {/* A phone has no left column: missions to join show under an empty plan instead. */}
        {phone && NET_ENABLED && stops.length === 0 && !running ? (
          <Suspense fallback={null}>
            <JoinList />
          </Suspense>
        ) : null}
      </div>

      {stops.length > 0 && !locked ? (
        <footer className="flex shrink-0 items-center justify-end border-t px-3 py-2">
          <button
            type="button"
            onClick={() => {
              const before = useApp.getState().plan;
              clearPlan();
              toast('Plan cleared', { action: { label: 'Undo', onClick: () => useApp.getState().setPlan(before) } });
            }}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Clear the plan
          </button>
        </footer>
      ) : null}
    </section>
  );
}
