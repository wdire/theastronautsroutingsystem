import type { ReactNode } from 'react';
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
import { useIsPhone } from '@/ui/hooks/useMediaQuery';

function EmptyPanel({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function DockContent() {
  const dock = useApp((s) => s.dock);
  if (!dock) return null;
  return (
    <DockPanel tab={dock}>
      <EmptyPanel>This panel is being built.</EmptyPanel>
    </DockPanel>
  );
}

/** Everything drawn over the map once the camera has landed in the region. */
export function Chrome() {
  const phone = useIsPhone();

  if (phone) {
    return (
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute inset-x-2.5 top-[max(0.625rem,env(safe-area-inset-top))] flex flex-col items-end gap-2">
          <div className="w-full">
            <SearchBox leading={<MainMenu />} />
          </div>
          <ClockMenu />
        </div>
        <div className="pointer-events-auto absolute right-2.5 bottom-[max(1.5rem,env(safe-area-inset-bottom))]">
          <MapButtons withLayers />
        </div>
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[62dvh] flex-col [&>*]:rounded-b-none [&>*]:border-x-0 [&>*]:border-b-0">
          <PlaceCard />
        </div>
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[72dvh] justify-center [&>section]:w-full [&>section]:max-w-none [&>section]:rounded-b-none">
          <DockContent />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute top-3 bottom-3 left-3 flex w-[372px] flex-col gap-2 [&>*]:pointer-events-auto">
        <SearchBox leading={<MainMenu />} />
        <PlaceCard />
      </div>

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
