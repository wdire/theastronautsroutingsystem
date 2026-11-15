import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Volume2, VolumeOff } from "lucide-react";
import { useApp } from "@/store";
import { getMap } from "@/map/instance";
import { flyIn, JEZERO_VIEW } from "@/map/camera";
import { lightTimeS, marsTime, sunPosition } from "@/engines/marsTime";
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useSound } from "@/audio/useSound";

const [LON, LAT] = JEZERO_VIEW.center;

/** Northern seasons by solar longitude. Jezero is at 18° N, so these are its own. */
function season(lsDeg: number): string {
  const i = Math.floor(lsDeg / 90);
  return i === 0
    ? "Spring"
    : i === 1
      ? "Summer"
      : i === 2
        ? "Autumn"
        : "Winter";
}

function fmtLightTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, "0")} s`;
}

/** A line that rises into place on the first visit. `delay` is in ms. */
function Rise({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("intro-rise", className)}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** The name, set in the widest cut of the family until the real logo arrives. */
function Wordmark() {
  return (
    <div
      className="flex items-center gap-3.5 select-none"
      aria-label="TARS, The Astronauts’ Routing System"
      role="img"
    >
      <span className="text-[1.375rem] leading-none font-extrabold tracking-[0.12em] text-[#fbf4ea] [font-stretch:125%] sm:text-[1.5rem]">
        TARS
      </span>
      <span className="hidden h-6 w-px bg-white/20 sm:block" />
      <span className="hidden text-[0.625rem] leading-[1.35] font-medium tracking-[0.2em] text-[#b9ad9f] uppercase [font-stretch:110%] sm:block">
        The Astronauts’
        <br />
        Routing System
      </span>
    </div>
  );
}

function Readout({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-end gap-1.5", className)}>
      <span className="text-[0.625rem] leading-none font-medium tracking-[0.18em] text-[#9d9286] uppercase">
        {label}
      </span>
      <span className="figure text-[0.9375rem] leading-none font-semibold text-[#f4ece1] [font-stretch:94%]">
        {children}
      </span>
    </div>
  );
}

/** Live numbers for Jezero, from the app's own Mars clock. */
function Telemetry() {
  const second = useApp((s) => Math.floor(s.utcMs / 1000));
  const utcMs = second * 1000;
  const t = marsTime(utcMs, LON);
  const sun = sunPosition(utcMs, LAT, LON);
  const day =
    sun.elevDeg > -1 ? (sun.elevDeg < 8 ? "Sun low" : "Day") : "Night";

  return (
    <div className="flex items-start gap-7 lg:gap-10">
      <Readout label="Jezero local time">
        <span
          className="mr-2 inline-block size-1.5 translate-y-[-0.15em] animate-pulse rounded-full bg-[#9cc4ea] motion-reduce:animate-none"
          aria-hidden
        />
        {fmtClock(t.ltstH)}
        <span className="ml-1.5 text-[0.75rem] font-medium text-[#a89d90]">
          {day}
        </span>
      </Readout>
      <Readout label="Signal from Earth" className="hidden md:flex">
        {fmtLightTime(lightTimeS(utcMs))}
      </Readout>
      <Readout label="Season" className="hidden lg:flex">
        {season(t.lsDeg)}
        <span className="ml-1.5 text-[0.75rem] font-medium text-[#a89d90]">
          Ls {Math.round(t.lsDeg)}°
        </span>
      </Readout>
    </div>
  );
}

/** Sound on or off, beside the clock: the flight down is the first thing heard. */
function SoundToggle() {
  const [on, setOn] = useSound();
  const Icon = on ? Volume2 : VolumeOff;
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      aria-label="Sound effects"
      title={on ? "Sound effects on" : "Sound effects off"}
      className="pointer-events-auto -mt-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[#b9ad9f] transition-colors duration-200 hover:bg-white/[0.06] hover:text-[#fbf4ea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9cc4ea]"
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

/** The opening screen: the planet, a sky, one sentence, one way in. */
export function Intro() {
  const mode = useApp((s) => s.mode);
  const flying = useApp((s) => s.flying);
  const visible = mode === "globe" && !flying;

  useEffect(() => {
    if (mode !== "globe") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("a[href]")) return;
      if (
        target &&
        target !== document.body &&
        target.closest('button, a, input, textarea, [role="dialog"]') &&
        !target.closest("[data-intro]")
      )
        return;
      const map = getMap();
      if (map) flyIn(map);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
        "pointer-events-none absolute inset-0 z-10 transition-opacity duration-500 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 px-6 pt-6 sm:px-12 sm:pt-9">
        <Rise delay={0}>
          <Wordmark />
        </Rise>
        <Rise delay={500} className="flex items-start gap-5 lg:gap-7">
          <Telemetry />
          <SoundToggle />
        </Rise>
      </header>

      <div className="absolute inset-x-0 bottom-0 px-6 pb-8 sm:px-12 sm:pb-12">
        <div className="pointer-events-auto max-w-[36rem]">
          <Rise delay={150}>
            <p className="figure flex items-center gap-3 text-[0.6875rem] font-medium tracking-[0.2em] text-[#c9bdae] uppercase">
              Jezero crater · 18.4° N 77.6° E
            </p>
          </Rise>
          <h1 className="mt-4 text-[clamp(2.75rem,6.4vw,5.25rem)] leading-[0.94] font-semibold tracking-[-0.035em] text-[#fbf4ea] [font-stretch:86%] sm:mt-5">
            <span className="intro-line">
              <span
                className="intro-line-inner"
                style={{ "--d": "220ms" } as CSSProperties}
              >
                Plan a walk
              </span>
            </span>{" "}
            <span className="intro-line">
              <span
                className="intro-line-inner"
                style={{ "--d": "310ms" } as CSSProperties}
              >
                on Mars.
              </span>
            </span>
          </h1>
          <Rise delay={440}>
            <p className="intro-optional mt-5 max-w-[23rem] text-[1rem] leading-relaxed text-[#ddd2c4] sm:mt-6 sm:text-[1.0625rem] xl:max-w-[31rem]">
              Jezero crater, where Perseverance landed, mapped from orbit down
              to 25&nbsp;cm. Draw a route, check oxygen, radiation and dust
              along the way, then walk it in the helmet view.
            </p>
          </Rise>
          <Rise delay={560} className="mt-7 flex items-center gap-4 sm:mt-8">
            <button
              type="button"
              onClick={enter}
              className="group inline-flex h-12 items-center gap-3 rounded-md bg-[#fbf4ea] pr-4.5 pl-5.5 text-[0.9375rem] font-semibold text-[#1b1512] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_10px_30px_-10px_rgb(232_160_110/0.45)] transition-[background-color,box-shadow] duration-200 hover:bg-white hover:shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_12px_36px_-8px_rgb(232_160_110/0.6)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#9cc4ea] active:translate-y-px"
            >
              Go to Jezero
              <ArrowRight
                className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
            <span className="hidden text-sm text-[#a89d90] sm:inline">
              or press{" "}
              <kbd className="ml-0.5 rounded border border-white/20 bg-white/[0.04] px-1.5 py-0.5 font-sans text-xs text-[#efe6da]">
                Enter
              </kbd>
            </span>
          </Rise>
          <Rise delay={700}>
            <div className="mt-10 hidden text-[0.75rem] text-[#8a8075] sm:block">
              <p>On NASA orbital data: HiRISE, CTX, THEMIS and MOLA.</p>
              <a
                href="https://github.com/wdire/theastronautsroutingsystem"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 underline-offset-[3px] transition-colors duration-200 hover:text-[#ddd2c4] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9cc4ea]"
              >
                Source code on GitHub
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </div>
          </Rise>
        </div>
      </div>
    </section>
  );
}
