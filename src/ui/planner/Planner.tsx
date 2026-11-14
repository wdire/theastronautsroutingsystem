import { lazy, Suspense } from 'react';
import { Bot, Car, Caravan, Check, ChevronDown, Footprints, Helicopter, House, MousePointerClick, Move, Plus, TriangleAlert, X, Plane, Play } from 'lucide-react';
import { flySelectedRoute } from '@/map/flyover';
import { startMission } from '@/sim/controller';
import { Budget } from './Budget';
import { Departure } from './Departure';
import { Exports } from './Exports';
import { toast } from 'sonner';
import type { RouteAlternative, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { useApp } from '@/store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { fmtDeg, fmtDistance, fmtDuration, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { StopList } from './StopList';
import { stopLabel } from '@/planner/labels';
import { planLocked, useCrew } from '@/net/state';
import { NET_ENABLED } from '@/net/config';
import { startsAtBase } from '@/planner/base';

// Who goes: loaded with the crew code, only when there is a crew server.
const PlannerCrew = lazy(() => import('@/ui/crew/PlannerCrew'));

const VEHICLE_ICON = { foot: Footprints, openRover: Car, pressRover: Caravan, robotRover: Bot, heli: Helicopter } as const;
const VEHICLE_ORDER: readonly VehicleId[] = ['foot', 'openRover', 'pressRover', 'robotRover', 'heli'];

function VehiclePicker() {
  const vehicle = useApp((s) => s.plan.vehicle);
  const setVehicle = useApp((s) => s.setVehicle);
  const v = VEHICLES[vehicle];
  const Icon = VEHICLE_ICON[vehicle];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Vehicle: ${v.name}. Change vehicle`}
          className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted"
        >
          <Icon className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">{v.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{v.blurb}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[340px]">
        {VEHICLE_ORDER.map((id) => {
          const item = VEHICLES[id];
          const ItemIcon = VEHICLE_ICON[id];
          return (
            <DropdownMenuItem key={id} onSelect={() => setVehicle(id)} className="items-start gap-3 py-2">
              <ItemIcon className="mt-0.5 size-[18px]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{item.name}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{item.blurb}</span>
              </span>
              {id === vehicle ? <Check className="mt-0.5 size-4 text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
    const { nearest, leg } = route;
    return (
      <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium">Leg {leg + 1} has no route.</span> {route.message}
          </span>
        </p>
        {nearest ? (
          <button
            type="button"
            onClick={() => {
              const s = useApp.getState();
              // Leg n ends at stop n; on a round trip the last leg ends back at the start.
              const stop = s.plan.stops[leg];
              if (stop) s.updateStop(stop.id, { lon: nearest[0], lat: nearest[1] });
            }}
            className="mt-2 ml-6 inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] font-medium hover:bg-secondary"
          >
            Move the stop to the nearest reachable spot
          </button>
        ) : null}
      </div>
    );
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
      <div className="mt-4 flex flex-wrap gap-2">
        {route.hasBudget && !missionRunning && !locked ? (
          <button
            type="button"
            // A plan that runs out of air, battery or daylight is not flown: the crew would not come back.
            disabled={!chosen.trip.feasible}
            title={chosen.trip.feasible ? undefined : 'This plan does not work as it stands. Change it until it does.'}
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
          className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11"
        >
          <Plane className="size-4 text-muted-foreground" aria-hidden />
          Fly along the route
        </button>
      </div>
      <Exports alt={chosen} hasBudget={route.hasBudget} />
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
          <VehiclePicker />
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
          <div className="flex items-center gap-2 rounded-md border py-1.5 pr-1 pl-3">
            <House className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{atMyBase ? base.name : start ? `${stopLabel(start)}, the commander's base` : base.name}</span>
            {atMyBase && !running ? <PickButton target="base">Move base</PickButton> : null}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Every mission leaves the base and comes back to it.</p>
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
