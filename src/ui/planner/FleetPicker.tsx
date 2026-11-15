/**
 * Who and what goes: the number of people and the vehicles, each added and taken away on its own. The trip is
 * costed for whatever holds the convoy back, and the picker says what that is and why.
 */
import { Bot, Car, Caravan, Footprints, Helicopter, Info, Minus, Plus, TriangleAlert, Users } from 'lucide-react';
import type { FleetEntry, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { checkFleet, FLEET_VEHICLES, fleetOf, MAX_OF_EACH, MAX_PEOPLE, peopleOf, vehicleFacts } from '@/engines/fleet';
import { useApp } from '@/store';
import { useCrew } from '@/net/state';
import { cn } from '@/lib/cn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';

const VEHICLE_ICON = { foot: Footprints, openRover: Car, pressRover: Caravan, robotRover: Bot, heli: Helicopter } as const;

/** The (i) beside a vehicle: what it carries, how fast and how far it goes, and what it breathes. */
export function VehicleInfo({ id }: { id: VehicleId }) {
  const v = VEHICLES[id];
  const f = vehicleFacts(v);
  const rows: [string, string][] = [
    ['Carries', f.seats],
    ['Top speed', f.speed],
    ['Slopes', f.slope],
  ];
  if (f.air) rows.push(['Air', f.air]);
  if (f.range) rows.push(['Range', f.range]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About the ${id === 'foot' ? 'walkers' : v.name.toLowerCase()}`}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="text-[13px] font-semibold">{id === 'foot' ? 'Walking in suits' : v.name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{v.blurb}</p>
        <dl className="mt-2.5 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
          {rows.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="figure">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[11px] leading-relaxed text-faint">Range is for level ground by day with no stops. The plan works out the real trip over the terrain.</p>
      </PopoverContent>
    </Popover>
  );
}

function Stepper({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  const btn = 'inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-9';
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center rounded-md border">
      <button type="button" aria-label={`One fewer: ${label}`} className={btn} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-3.5" aria-hidden />
      </button>
      <span aria-label={`${label}: ${value}`} className="figure w-6 text-center text-[13px] font-semibold">
        {value}
      </span>
      <button type="button" aria-label={`One more: ${label}`} className={btn} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function paceWords(pace: VehicleId, people: number): string {
  const v = VEHICLES[pace];
  if (pace === 'foot') return people === 1 ? 'Walks at up to 3.3 km/h on suit air.' : 'Everyone walks, at up to 3.3 km/h on suit air.';
  if (pace === 'openRover') return 'Rides at up to 10 km/h. The crew breathe suit air the whole way.';
  if (pace === 'pressRover') return 'Rides at up to 10 km/h in a cabin, and can camp overnight.';
  return `No one goes: the ${v.name.toLowerCase()} works alone.`;
}

/** The fleet and the head count. In a crew mission the head count is the crew list, not a number to set. */
export function FleetPicker() {
  const plan = useApp((s) => s.plan);
  const setFleet = useApp((s) => s.setFleet);
  const roster = useApp((s) => s.roster);
  const onCrewMission = useCrew((s) => s.current !== null);
  const fleet = fleetOf(plan);
  const people = peopleOf(plan);
  const check = checkFleet(fleet, people);
  const crewCount = onCrewMission && roster ? roster.length : null;

  const setCount = (id: VehicleId, count: number) => {
    const next: FleetEntry[] = FLEET_VEHICLES.map((vehicle) => ({ vehicle, count: vehicle === id ? count : (fleet.find((f) => f.vehicle === vehicle)?.count ?? 0) }));
    setFleet(next, people);
  };
  const missing = FLEET_VEHICLES.filter((id) => !fleet.some((f) => f.vehicle === id));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Who and what goes</h3>
        <span className="figure text-xs text-muted-foreground">
          {check.seats > 0 ? `${check.seats} ${check.seats === 1 ? 'seat' : 'seats'} for ${people}` : null}
        </span>
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        <li className="flex items-center gap-2 py-1 pr-1 pl-3">
          <Users className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{crewCount !== null ? 'Crew' : 'People'}</span>
          <VehicleInfo id="foot" />
          {crewCount !== null ? (
            <span className="figure px-2 text-[13px] font-semibold" title="The crew list below sets this">
              {crewCount}
            </span>
          ) : (
            <Stepper label="People" value={people} min={0} max={MAX_PEOPLE} onChange={(n) => setFleet(fleet, n)} />
          )}
        </li>
        {fleet.map((f) => {
          const v = VEHICLES[f.vehicle];
          const Icon = VEHICLE_ICON[f.vehicle];
          return (
            <li key={f.vehicle} className="flex items-center gap-2 py-1 pr-1 pl-3">
              <Icon className={cn('size-4 shrink-0', f.vehicle === check.pace ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{v.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{v.crew > 0 ? `${v.crew} seats each` : 'Carries no one'}</span>
              </span>
              <VehicleInfo id={f.vehicle} />
              <Stepper label={v.name} value={f.count} min={0} max={MAX_OF_EACH} onChange={(n) => setCount(f.vehicle, n)} />
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p className="min-w-0 pt-1.5 text-xs leading-relaxed text-muted-foreground">{check.problems.length > 0 || (check.walkers > 0 && check.seats > 0) ? null : paceWords(check.pace, people)}</p>
        {missing.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-primary transition-colors hover:bg-secondary data-[state=open]:bg-secondary">
                <Plus className="size-3.5" aria-hidden />
                Add a vehicle
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px]">
              {missing.map((id) => {
                const v = VEHICLES[id];
                const Icon = VEHICLE_ICON[id];
                return (
                  <DropdownMenuItem key={id} onSelect={() => setCount(id, 1)} className="items-start gap-3 py-2">
                    <Icon className="mt-0.5 size-[18px]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{v.name}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{v.blurb}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {check.problems.map((p) => (
        <p key={p} role="alert" className="mt-1.5 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-2.5 py-2 text-xs leading-relaxed">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {p}
        </p>
      ))}
      {check.notes.map((n) => (
        <p key={n} className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {n}
        </p>
      ))}
    </div>
  );
}
