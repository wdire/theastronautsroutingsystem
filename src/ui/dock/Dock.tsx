import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useApp, type DockTab } from '@/store';
import { cn } from '@/lib/cn';
import { DOCK_TABS } from './tabs';

/** The rail of tabs on the right. One panel shows at a time; a tab switches it or hides it. */
export function DockRail() {
  const dock = useApp((s) => s.dock);
  const toggleDock = useApp((s) => s.toggleDock);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const last = DOCK_TABS.length - 1;
    let next = -1;
    if (e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next >= 0) {
      e.preventDefault();
      refs.current[next]?.focus();
    }
  };

  const focusable = dock ?? DOCK_TABS[0]?.id;

  return (
    <div role="tablist" aria-orientation="vertical" aria-label="Panels" className="panel flex flex-col gap-0.5 p-0.5">
      {DOCK_TABS.map((tab, i) => {
        const selected = dock === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`dock-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="dock-panel"
            tabIndex={tab.id === focusable ? 0 : -1}
            title={tab.title}
            onClick={() => toggleDock(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative flex h-[50px] w-[54px] flex-col items-center justify-center gap-1 rounded-md text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground',
              selected && 'bg-secondary text-foreground',
            )}
          >
            <Icon className={cn('size-[18px]', selected && 'text-primary')} aria-hidden />
            <span className="text-[10.5px] leading-none font-medium tracking-[0.01em]">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The frame every dock panel shares: a title, a way to close, a scrolling body. */
export function DockPanel({ tab, children }: { tab: DockTab; children: ReactNode }) {
  const openDock = useApp((s) => s.openDock);
  const meta = DOCK_TABS.find((t) => t.id === tab);
  return (
    <section
      id="dock-panel"
      role="tabpanel"
      aria-labelledby={`dock-tab-${tab}`}
      className="panel flex max-h-full w-[344px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden max-md:w-full max-md:max-w-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          openDock(null);
          document.getElementById(`dock-tab-${tab}`)?.focus();
        }
      }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.005em]">{meta?.title}</h2>
        <button
          type="button"
          aria-label={`Close ${meta?.title ?? 'panel'}`}
          onClick={() => openDock(null)}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
