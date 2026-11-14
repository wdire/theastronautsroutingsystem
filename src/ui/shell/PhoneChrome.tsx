import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Route } from 'lucide-react';
import { useApp, type DockTab } from '@/store';
import { DOCK_TABS } from '@/ui/dock/tabs';
import { MapButtons } from '@/ui/mapctl/MapButtons';
import { ReliefChip } from '@/ui/mapctl/ReliefChip';
import { SearchBox } from '@/ui/search/SearchBox';
import { ClockMenu } from '@/ui/clock/ClockMenu';
import { cn } from '@/lib/cn';
import { MainMenu } from './MainMenu';
import { Sheet } from './Sheet';

type Content = 'place' | 'dock' | 'planner';

const SHEET_LABEL: Record<Content, string> = { place: 'Place', dock: 'Panel', planner: 'Mission plan' };

function NavButton({ id, label, active, onClick, children }: { id?: string; label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      id={id}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 text-muted-foreground transition-colors active:bg-secondary [&_svg]:size-5',
        active && 'text-primary',
      )}
    >
      {children}
      <span className={cn('text-[11px] leading-none font-medium', active && 'text-foreground')}>{label}</span>
    </button>
  );
}

/**
 * The phone layout: search and clock on top, a labelled bar at the bottom, and one sheet above the
 * bar for whatever is open. A place takes the sheet over a panel, and a panel over the plan; closing
 * one shows what was under it.
 */
export function PhoneChrome({ place, planner, dockPanel }: { place: ReactNode; planner: ReactNode; dockPanel: ReactNode }) {
  const placeOpen = useApp((s) => s.placeId !== null);
  const plannerOpen = useApp((s) => s.plannerOpen);
  const dock = useApp((s) => s.dock);
  // Choosing a point, or watching the camera fly the route: either way the map is what matters.
  const stepAside = useApp((s) => s.picking !== null || s.flyover !== null);
  const content: Content | null = placeOpen ? 'place' : dock ? 'dock' : plannerOpen ? 'planner' : null;
  // Each thing that opens gets its own sheet, starting at half height.
  const key = content === 'dock' ? `dock:${dock}` : (content ?? '');

  const topRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [clear, setClear] = useState({ top: 70, bottom: 56 });
  useLayoutEffect(() => {
    const measure = () => {
      const top = Math.round((topRef.current?.getBoundingClientRect().bottom ?? 62) + 8);
      const bottom = Math.round(navRef.current?.offsetHeight ?? 56);
      setClear((c) => (c.top === top && c.bottom === bottom ? c : { top, bottom }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const s = useApp.getState;
  const togglePlan = () => {
    if (content === 'planner') return s().openPlanner(false);
    s().openDock(null);
    s().openPlanner(true);
  };
  const toggleDock = (tab: DockTab) => {
    if (content === 'dock' && dock === tab) return s().openDock(null);
    s().openPlace(null);
    s().openDock(tab);
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute inset-x-2.5 top-[max(0.625rem,env(safe-area-inset-top))] flex flex-col items-end gap-2">
        <div ref={topRef} className="w-full">
          <SearchBox leading={<MainMenu />} />
        </div>
        <ClockMenu />
      </div>

      <div className="absolute bottom-0 left-2.5 pb-2" style={{ marginBottom: clear.bottom }}>
        <ReliefChip />
      </div>
      <div className="pointer-events-auto absolute right-2.5" style={{ bottom: clear.bottom + 12 }}>
        <MapButtons compact />
      </div>

      {content ? (
        <Sheet key={key} forcePeek={stepAside} label={SHEET_LABEL[content]} topClear={clear.top} bottomClear={clear.bottom}>
          {content === 'place' ? place : content === 'dock' ? dockPanel : planner}
        </Sheet>
      ) : null}

      <nav ref={navRef} aria-label="Panels" className="pointer-events-auto absolute inset-x-0 bottom-0 flex border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <NavButton label="Plan" active={content === 'planner'} onClick={togglePlan}>
          <Route aria-hidden />
        </NavButton>
        {DOCK_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavButton key={tab.id} id={`dock-tab-${tab.id}`} label={tab.label} active={content === 'dock' && dock === tab.id} onClick={() => toggleDock(tab.id)}>
              <Icon aria-hidden />
            </NavButton>
          );
        })}
      </nav>
    </div>
  );
}
