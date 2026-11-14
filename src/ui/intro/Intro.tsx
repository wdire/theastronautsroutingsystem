import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useApp } from '@/store';
import { getMap } from '@/map/instance';
import { flyIn } from '@/map/camera';
import { cn } from '@/lib/cn';

/** The opening screen: the planet, one sentence, one way in. */
export function Intro() {
  const mode = useApp((s) => s.mode);
  const flying = useApp((s) => s.flying);
  const visible = mode === 'globe' && !flying;

  useEffect(() => {
    if (mode !== 'globe') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && target !== document.body && target.closest('button, a, input, textarea, [role="dialog"]') && !target.closest('[data-intro]')) return;
      const map = getMap();
      if (map) flyIn(map);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const enter = () => {
    const map = getMap();
    if (map) flyIn(map);
  };

  return (
    <section
      data-intro
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-start p-6 pb-10 transition-opacity duration-500 ease-out sm:p-12 sm:pb-14',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="pointer-events-auto max-w-[34rem]">
        <h1 className="text-[clamp(2.5rem,6vw,4.25rem)] leading-[0.98] font-semibold tracking-[-0.025em] text-[#fbf4ea] [font-stretch:88%]">
          Plan a walk on Mars
        </h1>
        <p className="mt-5 max-w-[30rem] text-[1.0625rem] leading-relaxed text-[#e4d9cb]">
          Jezero crater, where Perseverance landed, and the land around it. Plan a route on real orbital data, check
          oxygen, radiation and dust, then walk it in the helmet view.
        </p>
        <div className="mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={enter}
            className="group inline-flex h-11 items-center gap-2.5 rounded-md bg-[#fbf4ea] pr-4 pl-5 text-[0.9375rem] font-semibold text-[#1b1512] transition-colors duration-150 hover:bg-white active:translate-y-px"
          >
            Go to Jezero
            <ArrowRight className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden />
          </button>
          <span className="hidden text-sm text-[#c9bdae] sm:inline">
            or press <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans text-xs text-[#efe6da]">Enter</kbd>
          </span>
        </div>
      </div>
    </section>
  );
}
