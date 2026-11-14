import { useEffect } from 'react';
import { MapView } from '@/map/MapView';
import { whenMapReady } from '@/map/instance';
import { addGlobeMarker } from '@/map/globeMarker';
import { Intro } from '@/ui/intro/Intro';
import { Chrome } from '@/ui/shell/Chrome';
import { TooltipProvider } from '@/ui/components/ui/tooltip';
import { Toaster } from '@/ui/components/ui/sonner';
import { useApp } from '@/store';
import { cn } from '@/lib/cn';

function Wordmark() {
  return (
    <div className="pointer-events-none absolute top-5 left-6 z-10 select-none sm:top-8 sm:left-12">
      <span className="text-[1.375rem] font-bold tracking-[-0.02em] text-[#fbf4ea] [font-stretch:112%]">Areo</span>
    </div>
  );
}

export function App() {
  const mode = useApp((s) => s.mode);
  const landed = useApp((s) => s.landed);
  const theme = useApp((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;
    whenMapReady((map) => {
      if (!cancelled) remove = addGlobeMarker(map);
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  const inMap = mode === 'map';

  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={200}>
    <div className="space absolute inset-0 overflow-hidden">
      <MapView />
      <div className={cn('transition-opacity duration-500', mode === 'globe' ? 'opacity-100' : 'opacity-0')}>
        <Wordmark />
      </div>
      <Intro />
      {/* The map chrome fades in once, after the first landing, and never waits again. */}
      <div
        className={cn(
          'absolute inset-0 z-20 transition-opacity',
          landed ? 'duration-700' : 'duration-0',
          inMap ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        inert={!inMap}
      >
        <Chrome />
      </div>
      <Toaster position="bottom-center" />
    </div>
    </TooltipProvider>
  );
}
