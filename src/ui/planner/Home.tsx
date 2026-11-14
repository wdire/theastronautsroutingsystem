/**
 * The left column when nothing else is open: the base, the way into planning, the mission the visitor is on,
 * and the missions they could join. Missions are made and found here; the Crew tab is about the one you fly.
 */
import { lazy, Suspense } from 'react';
import { ArrowRight, House, Route, Users } from 'lucide-react';
import { getMap } from '@/map/instance';
import { NET_ENABLED } from '@/net/config';
import { useCrew } from '@/net/state';
import { fmtLatLon } from '@/lib/format';
import { useApp } from '@/store';
import { PickButton } from './Planner';

const JoinList = lazy(() => import('@/ui/crew/JoinList'));

function BaseRow() {
  const base = useApp((s) => s.base);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        aria-label={`Show ${base.name} on the map`}
        onClick={() => getMap()?.flyTo({ center: [base.lon, base.lat], zoom: 15.5, duration: 1400 })}
        className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-foreground transition-colors hover:bg-secondary/70"
      >
        <House className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold">{base.name}</span>
        <span className="figure block truncate text-xs text-muted-foreground">Your base · {fmtLatLon(base.lat, base.lon)}</span>
      </span>
      <PickButton target="base">Move</PickButton>
    </div>
  );
}

function CurrentMission() {
  const current = useCrew((s) => s.current);
  if (!current) return null;
  const open = () => {
    const s = useApp.getState();
    s.openPlanner(true);
    s.openDock('crew');
  };
  return (
    <button type="button" onClick={open} className="flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-secondary/60">
      <Users className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold">{current.title}</span>
        <span className="block text-xs text-muted-foreground">
          {current.status === 'planning' ? (current.isCommander ? 'You command it. Being planned.' : 'You are crew. Being planned.') : 'Under way'}
        </span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function Home() {
  const planned = useApp((s) => s.plan.stops.length);
  const onMission = useCrew((s) => s.current !== null);
  const openPlanner = useApp((s) => s.openPlanner);
  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden" aria-label="Missions">
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <BaseRow />
        <CurrentMission />
        {onMission ? null : (
          <div className="border-t px-4 py-3">
            <button
              type="button"
              onClick={() => openPlanner(true)}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 pointer-coarse:h-11"
            >
              <Route className="size-4" aria-hidden />
              {planned > 0 ? 'Open the mission plan' : 'Plan a mission'}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Out from the base and back, on foot or by rover. Bring a crew if you like.</p>
          </div>
        )}
        {NET_ENABLED ? (
          <Suspense fallback={null}>
            <JoinList />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}
