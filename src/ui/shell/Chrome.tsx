import { useSpaceWeatherFeed } from '@/ui/hooks/useSpaceWeather';
import { TooltipProvider } from '@/ui/components/ui/tooltip';
import { Toaster } from '@/ui/components/ui/sonner';
import { useApp } from '@/store';
import { DockPanel, DockRail } from '@/ui/dock/Dock';
import { MapButtons } from '@/ui/mapctl/MapButtons';
import { ScaleBar } from '@/ui/mapctl/ScaleBar';
import { CursorReadout } from '@/ui/mapctl/CursorReadout';
import { SearchBox } from '@/ui/search/SearchBox';
import { MainMenu } from './MainMenu';
import { PlaceCard } from '@/ui/place/PlaceCard';
import { ReliefChip } from '@/ui/mapctl/ReliefChip';
import { DescendHint } from '@/ui/mapctl/DescendHint';
import { ClockMenu } from '@/ui/clock/ClockMenu';
import { Planner } from '@/ui/planner/Planner';
import { LayersPanel } from '@/ui/panels/LayersPanel';
import { DiscoverPanel } from '@/ui/panels/DiscoverPanel';
import { MissionsPanel } from '@/ui/panels/MissionsPanel';
import { HowPanel } from '@/ui/panels/HowPanel';
import { Home } from '@/ui/planner/Home';
import { useIsPhone, useIsTouch } from '@/ui/hooks/useMediaQuery';
import { PhoneChrome } from './PhoneChrome';
import { FlyoverBar } from '@/ui/mapctl/FlyoverBar';
import { Hints } from './Hints';
import { RunPanel } from '@/ui/run/RunPanel';
import { MissionPanel } from '@/ui/run/MissionPanel';
import { Alerts } from '@/ui/run/Alerts';
import { lazy, Suspense } from 'react';
import { NET_ENABLED } from '@/net/config';
import { useCrew } from '@/net/state';

// The crew panels load when first opened; they exist only with a crew server.
const CrewPanel = lazy(() => import('@/ui/crew/CrewPanel'));
const DebriefDialog = lazy(() => import('@/ui/crew/Debrief'));

/** The debrief opens over everything, from the crew panel or from the end of a run. */
function CrewDialogs() {
  const open = useCrew((s) => s.debriefId !== null);
  if (!NET_ENABLED || !open) return null;
  return (
    <Suspense fallback={null}>
      <DebriefDialog />
    </Suspense>
  );
}

function DockContent() {
  const dock = useApp((s) => s.dock);
  if (!dock) return null;
  return (
    <DockPanel tab={dock}>
      {dock === 'layers' ? (
        <LayersPanel />
      ) : dock === 'discover' ? (
        <DiscoverPanel />
      ) : dock === 'missions' ? (
        <MissionsPanel />
      ) : dock === 'crew' && NET_ENABLED ? (
        <Suspense fallback={<p className="px-4 py-4 text-[13px] text-muted-foreground">Loading…</p>}>
          <CrewPanel />
        </Suspense>
      ) : (
        <HowPanel />
      )}
    </DockPanel>
  );
}

/** The dock's panel, under the clock and beside the rail. */
function DockColumn() {
  return (
    <div className="absolute top-[68px] right-[78px] bottom-10 flex flex-col [&>*]:pointer-events-auto">
      <DockContent />
    </div>
  );
}

/** The left column shows one thing at a time: a place, the plan, or the way into planning. */
function LeftPanel() {
  const placeOpen = useApp((s) => s.placeId !== null);
  const plannerOpen = useApp((s) => s.plannerOpen);
  const running = useApp((s) => s.world !== null);
  if (placeOpen) return <PlaceCard />;
  if (plannerOpen) return <Planner />;
  // While a mission runs, the column is the mission: alerts, crew, supplies, stops, controls.
  if (running) return <MissionPanel />;
  return <Home />;
}

function PickingHint() {
  const picking = useApp((s) => s.picking);
  const touch = useIsTouch();
  if (!picking) return null;
  const verb = touch ? 'Tap' : 'Click';
  return (
    <div role="status" className="panel pointer-events-none absolute top-3 left-1/2 flex h-10 -translate-x-1/2 items-center gap-2 px-3.5 text-[13px] font-medium whitespace-nowrap max-md:top-[7.75rem]">
      {picking === 'base' ? `${verb} the map where the base should stand.` : picking === 'stop' ? `${verb} the map to add a stop.` : `${verb} the map where you want to stand.`}
      {touch ? null : <span className="text-muted-foreground">Esc cancels</span>}
    </div>
  );
}

/** Everything drawn over the map once the camera has landed in the region. */
export function Chrome() {
  useSpaceWeatherFeed();
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={200}>
      <ChromeLayout />
    </TooltipProvider>
  );
}

/** Toasts sit outside the chrome layer, which passes the pointer through to the map: an Undo must take a click. */
export function Toasts() {
  return <Toaster position="bottom-center" />;
}

function ChromeLayout() {
  const phone = useIsPhone();

  if (phone) {
    return (
      <>
        <PhoneChrome place={<PlaceCard />} planner={<Planner />} dockPanel={<DockContent />} />
        <PickingHint />
        <FlyoverBar />
        <Hints />
        <RunPanel />
        <Alerts />
        <CrewDialogs />
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
      <FlyoverBar />
      <Hints />
      <CrewDialogs />

      <div className="pointer-events-auto absolute top-3 right-3">
        <DockRail />
      </div>
      <div className="pointer-events-auto absolute top-3 right-[78px]">
        <ClockMenu />
      </div>
      <DockColumn />

      <div className="absolute bottom-[4.5rem] left-1/2 -translate-x-1/2">
        <DescendHint />
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
