/**
 * The mission while it runs, in the left column where it was planned: what the crew is doing, anything that
 * needs a decision, who went and in what, what they have left, the stops and their tasks, and the controls.
 * A phone keeps the compact run panel at the bottom instead.
 */
import { Binoculars, Check, Circle, House, LoaderCircle, Pause, Play, Square, Users } from 'lucide-react';
import { marsTime } from '@/engines/marsTime';
import { VEHICLES } from '@/engines/vehicles';
import { abortRun, setRunSpeed, toggleRunPaused } from '@/sim/controller';
import { SPEEDS, type MissionRun } from '@/sim/types';
import { crewAt, progress, timelineOf } from '@/sim/world';
import { useApp } from '@/store';
import { useCrew, watchingRun } from '@/net/state';
import { fmtClock, fmtDistance, fmtDuration, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fleetOf, peopleOf } from '@/engines/fleet';
import { AlertCard } from './Alerts';
import { Chat, Gauge, Outcome } from './RunPanel';
import { stateWords } from './runState';

const SMALL_BTN = 'inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary';

/** Who went, and in what: the crew roster on a crew mission, else the vehicle's own crew with the visitor commanding. */
function Party({ run }: { run: MissionRun }) {
  const roster = useApp((s) => s.roster);
  const me = useCrew((s) => s.me);
  const base = useApp((s) => s.base);
  const v = VEHICLES[run.vehicle];
  const headCount = peopleOf(run.plan);
  const fleet = fleetOf(run.plan);
  const what = fleet.length === 0 ? (headCount > 0 ? 'On foot' : v.name) : fleet.map((f) => `${f.count > 1 ? `${f.count} × ` : ''}${VEHICLES[f.vehicle].name}`).join(', ');
  const people = roster?.filter((m) => !m.android) ?? [];
  const androids = roster?.filter((m) => m.android) ?? [];
  const homeName = run.plan.start?.name ?? base.name;
  return (
    <section className="border-t px-4 py-3" aria-labelledby="run-party">
      <h3 id="run-party" className="mb-2 text-xs font-medium text-muted-foreground">
        Crew and vehicle
      </h3>
      <p className="text-[13px] leading-relaxed">
        <span className="font-medium">{what}</span>
        <span className="text-muted-foreground"> · from and back to {homeName}</span>
      </p>
      {roster ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[...people, ...androids].map((m) => (
            <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
              <span className="size-2 rounded-full" style={{ background: m.color }} aria-hidden />
              {m.name}
              <span className="text-muted-foreground">{m.android ? 'android' : m.role.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      ) : v.crew > 0 && headCount > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" aria-hidden />
          {headCount === 1
            ? `${me?.name ?? 'You'}, alone. A solo mission.`
            : `${headCount} going: ${me?.name ?? 'you'} commanding, with ${headCount - 1 === 1 ? 'one partner' : `${headCount - 1} others`}. A solo mission.`}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Uncrewed: driven from the base.</p>
      )}
    </section>
  );
}

/** The stops in order, each with its tasks and when the crew gets there. */
function Itinerary({ run, utcMs }: { run: MissionRun; utcMs: number }) {
  const tl = timelineOf(run);
  const lon = run.home[0];
  const eta = new Map(run.legStops.map((ls) => [ls.stopId, run.legStartUtcMs + (tl.arriveS[ls.index] ?? 0) * 1000]));
  const homeEta = run.homeIsAhead ? run.legStartUtcMs + tl.durationS * 1000 : null;
  return (
    <section className="border-t px-4 py-3" aria-labelledby="run-stops">
      <h3 id="run-stops" className="mb-2 text-xs font-medium text-muted-foreground">
        Stops and tasks
      </h3>
      <ol className="flex flex-col gap-2.5">
        {run.plan.stops.map((stop, i) => {
          const tasks = run.tasks.filter((t) => t.stopId === stop.id);
          const doing = tasks.some((t) => t.state === 'doing');
          const finished = tasks.length > 0 && tasks.every((t) => t.state === 'done' || t.state === 'skipped');
          const at = eta.get(stop.id);
          return (
            <li key={stop.id}>
              <div className="flex items-center gap-2">
                <span className={cn('figure grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold', finished ? 'bg-ok/25 text-ok' : doing ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground')}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{stop.name ?? `Stop ${i + 1}`}</span>
                {!finished && at !== undefined && at > utcMs ? <span className="figure shrink-0 text-xs text-muted-foreground">{fmtClock(marsTime(at, lon).ltstH)}</span> : null}
              </div>
              {tasks.length > 0 ? (
                <ul className="mt-1 ml-7 flex flex-col gap-0.5">
                  {tasks.map((t) => (
                    <li key={t.id} className={cn('flex items-center gap-1.5 text-xs', t.state === 'done' ? 'text-muted-foreground line-through decoration-faint' : 'text-foreground/90')}>
                      {t.state === 'done' ? <Check className="size-3 text-ok" aria-label="Done" /> : t.state === 'doing' ? <LoaderCircle className="size-3 animate-spin text-primary" aria-label="Under way" /> : <Circle className="size-3 text-faint" aria-label="To do" />}
                      {t.label}
                      <span className="figure text-faint">{t.minutes} min</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {run.homeIsAhead ? (
          <li className="flex items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground" aria-hidden>
              <House className="size-3" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Back at {run.plan.start?.name ?? 'the base'}</span>
            {homeEta !== null && homeEta > utcMs ? <span className="figure shrink-0 text-xs text-muted-foreground">{fmtClock(marsTime(homeEta, lon).ltstH)}</span> : null}
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function Controls() {
  const speed = useApp((s) => s.world?.speed ?? 1);
  const paused = useApp((s) => s.world?.paused ?? false);
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label="Speed" className="flex gap-0.5 rounded-md border p-0.5">
        {SPEEDS.map((sp) => (
          <button
            key={sp}
            type="button"
            role="radio"
            aria-checked={speed === sp}
            onClick={() => setRunSpeed(sp)}
            className={cn('figure h-8 min-w-9 rounded px-1.5 text-xs font-semibold transition-colors', speed === sp ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary')}
          >
            {sp}×
          </button>
        ))}
      </div>
      <button type="button" aria-label={paused ? 'Resume the mission' : 'Pause the mission'} title={paused ? 'Resume' : 'Pause'} onClick={toggleRunPaused} className="grid size-9 shrink-0 place-items-center rounded-md border transition-colors hover:bg-secondary">
        {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
      </button>
      <button type="button" aria-label="End the mission" title="End the mission" onClick={abortRun} className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <Square className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function MissionPanel() {
  const world = useApp((s) => s.world);
  const watching = useCrew(watchingRun);
  const linkStale = useCrew((s) => s.linkStale);
  const crewTitle = useCrew((s) => s.current?.title);
  const run = world?.run;
  if (!world || !run) return null;
  const crew = crewAt(run, world.utcMs);
  const prog = progress(run, world.utcMs);
  const ltst = marsTime(world.utcMs, crew.lon).ltstH;
  const running = run.status === 'running';
  const stops = run.stopIndices.slice(1, -1).map((i) => (run.carry.timeS + (run.trip.samples[i]?.tS ?? 0)) / Math.max(1, run.carry.timeS + run.trip.totals.durationS));

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden" aria-label="Mission">
      <header className="shrink-0 border-b px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.005em]">{crewTitle ?? run.name}</h2>
          <span className={cn('figure shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', running ? (world.paused ? 'bg-caution/15 text-caution' : 'bg-ok/15 text-ok') : 'bg-secondary text-muted-foreground')}>
            {running ? (world.paused ? 'Paused' : `Under way · ${world.speed}×`) : run.status === 'aborted' ? 'Ended' : 'Over'}
          </span>
        </div>
        {running ? (
          <>
            <p className="mt-1.5 text-[13.5px] font-medium" aria-live="polite">
              {stateWords(run, crew, prog.nextName)}
            </p>
            <p className="figure mt-0.5 text-xs text-muted-foreground">
              {fmtClock(ltst)} LTST{crew.state === 'move' ? ` · ${fmtDistance(prog.nextDistM)}, ${fmtDuration(prog.nextS)} to go` : ''} · tasks {prog.tasksDone} of {prog.tasksTotal}
            </p>
            <div className="relative mt-2.5 h-1.5 rounded-full bg-secondary" role="progressbar" aria-label="Mission progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.fraction * 100)}>
              <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${Math.max(0, Math.min(1, prog.fraction))})` }} />
              {stops.map((at, i) => (
                <span key={i} className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground/70" style={{ left: `${Math.max(0, Math.min(1, at)) * 100}%` }} aria-hidden />
              ))}
            </div>
          </>
        ) : null}
        {watching && linkStale && running ? (
          <p role="status" className="mt-2 rounded-md bg-caution/10 px-2.5 py-1.5 text-xs font-medium text-caution">
            Waiting for the commander’s link. The run shows where it was last heard.
          </p>
        ) : null}
      </header>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {!running ? (
          <div className="px-4 py-3">
            <Outcome run={run} />
          </div>
        ) : null}
        {running ? (
          <div className="px-4 pt-3 empty:hidden">
            <AlertCard />
          </div>
        ) : null}
        <section className="px-4 py-3" aria-label="Supplies">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Gauge label="Oxygen" frac={crew.o2Frac} {...(crew.o2Kg !== null ? { detail: `${fmtNumber(crew.o2Kg, 2)} kg` } : {})} />
            <Gauge label="Battery" frac={crew.batteryFrac} {...(crew.batteryKWh !== null ? { detail: `${fmtNumber(crew.batteryKWh, crew.batteryKWh < 10 ? 1 : 0)} kWh` } : {})} />
            <div className="min-w-[4.5rem]">
              <div className="text-xs text-muted-foreground">Dose</div>
              <div className="figure text-[13px] font-semibold">{fmtNumber(crew.doseMSv, 2)} mSv</div>
            </div>
          </div>
        </section>
        <Party run={run} />
        <Itinerary run={run} utcMs={world.utcMs} />
      </div>

      {running ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
          {watching ? <p className="text-xs text-muted-foreground">The commander sets speed and stops.</p> : <Controls />}
          <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2 [&_button]:max-w-none">
            <button type="button" onClick={() => useApp.getState().openVisor({ lon: crew.lon, lat: crew.lat, ride: true })} className={SMALL_BTN} title="Ride along in 3D">
              <Binoculars className="size-4 text-muted-foreground" aria-hidden />
              Ride along
            </button>
            <Chat world={world} />
          </div>
        </footer>
      ) : null}
    </section>
  );
}
