import { useApp } from '@/store';
import { DockPanel, DockRail } from '@/ui/dock/Dock';
import { MapButtons } from '@/ui/mapctl/MapButtons';
import { ScaleBar } from '@/ui/mapctl/ScaleBar';
import { CursorReadout } from '@/ui/mapctl/CursorReadout';
import { SearchBox } from '@/ui/search/SearchBox';
import { MainMenu } from './MainMenu';
import { PlaceCard } from '@/ui/place/PlaceCard';
import { ReliefChip } from '@/ui/mapctl/ReliefChip';
import { ClockMenu } from '@/ui/clock/ClockMenu';
import { Planner } from '@/ui/planner/Planner';
import { LayersPanel } from '@/ui/panels/LayersPanel';
import { DiscoverPanel } from '@/ui/panels/DiscoverPanel';
import { MissionsPanel } from '@/ui/panels/MissionsPanel';
import { HowPanel } from '@/ui/panels/HowPanel';
import { Route } from 'lucide-react';
import { useIsPhone, useMediaQuery } from '@/ui/hooks/useMediaQuery';
import { PhoneChrome } from './PhoneChrome';

function DockContent() {
  const dock = useApp((s) => s.dock);
  if (!dock) return null;
  return (
    <DockPanel tab={dock}>
      {dock === 'layers' ? <LayersPanel /> : dock === 'discover' ? <DiscoverPanel /> : dock === 'missions' ? <MissionsPanel /> : <HowPanel />}
    </DockPanel>
  );
}

/** The left column shows one thing at a time: a place, the plan, or the way into planning. */
function LeftPanel() {
  const placeOpen = useApp((s) => s.placeId !== null);
  const plannerOpen = useApp((s) => s.plannerOpen);
  const planned = useApp((s) => s.plan.stops.length + (s.plan.start ? 1 : 0));
  const openPlanner = useApp((s) => s.openPlanner);
  if (placeOpen) return <PlaceCard />;
  if (plannerOpen) return <Planner />;
  return (
    <button
      type="button"
      onClick={() => openPlanner(true)}
      className="panel flex h-11 items-center gap-2.5 self-start px-3.5 text-[13.5px] font-semibold transition-colors hover:bg-secondary"
    >
      <Route className="size-4 text-primary" aria-hidden />
      {planned > 0 ? 'Open the mission plan' : 'Plan a mission'}
    </button>
  );
}

function PickingHint() {
  const picking = useApp((s) => s.picking);
  const touch = useMediaQuery('(pointer: coarse)');
  if (!picking) return null;
  const verb = touch ? 'Tap' : 'Click';
  return (
    <div role="status" className="panel pointer-events-none absolute top-3 left-1/2 flex h-10 -translate-x-1/2 items-center gap-2 px-3.5 text-[13px] font-medium whitespace-nowrap max-md:top-[7.75rem]">
      {picking === 'start' ? `${verb} the map to set the start.` : picking === 'stop' ? `${verb} the map to add a stop.` : `${verb} the map where you want to stand.`}
      {touch ? null : <span className="text-muted-foreground">Esc cancels</span>}
    </div>
  );
}

/** Everything drawn over the map once the camera has landed in the region. */
export function Chrome() {
  const phone = useIsPhone();

  if (phone) {
    return (
      <>
        <PhoneChrome place={<PlaceCard />} planner={<Planner />} dockPanel={<DockContent />} />
        <PickingHint />
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute top-3 bottom-3 left-3 flex w-[372px] flex-col gap-2 [&>*]:pointer-events-auto">
        <SearchBox leading={<MainMenu />} />
        <LeftPanel />
      </div>
      <PickingHint />

      <div className="pointer-events-auto absolute top-3 right-3">
        <DockRail />
      </div>
      <div className="pointer-events-auto absolute top-3 right-[78px]">
        <ClockMenu />
      </div>
      <div className="absolute top-[68px] right-[78px] bottom-10 flex flex-col [&>*]:pointer-events-auto">
        <DockContent />
      </div>

      <div className="absolute right-[70px] bottom-3 flex items-end gap-5">
        <div className="hidden lg:block">
          <CursorReadout />
        </div>
        <ReliefChip />
        <ScaleBar />
      </div>
      <div className="pointer-events-auto absolute right-3 bottom-3">
        <MapButtons />
      </div>
    </div>
  );
}
