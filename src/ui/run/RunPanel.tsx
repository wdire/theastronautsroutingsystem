import { useEffect, useMemo, useRef, useState } from 'react';
import { Binoculars, FileText, MessageSquare, Pause, Play, Square } from 'lucide-react';
import { marsTime } from '@/engines/marsTime';
import { missionById } from '@/engines/missions';
import { abortRun, closeMission, sayToBase, setRunSpeed, toggleRunPaused } from '@/sim/controller';
import { SPEEDS, type MissionRun, type World } from '@/sim/types';
import { crewAt, progress } from '@/sim/world';
import { useApp } from '@/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { fmtClock, fmtDistance, fmtDuration, fmtNumber, fmtPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useCrew, watchingRun } from '@/net/state';
import { stateWords } from './runState';
import { baseQuestion, splitBaseCalls, withoutBaseCall } from '@/net/words';

/** A level as a number and a bar; the bar turns amber, then red, as the reserve comes near. */
export function Gauge({ label, frac, detail }: { label: string; frac: number | null; detail?: string }) {
  if (frac === null) return null;
  const f = Math.max(0, Math.min(1, frac));
  const tone = f < 0.2 ? 'bg-warning' : f < 0.35 ? 'bg-caution' : 'bg-primary';
  return (
    <div className="min-w-[5.5rem]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="figure font-semibold">{fmtPercent(f)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
        <div className={cn('h-full origin-left rounded-full', tone)} style={{ transform: `scaleX(${f})` }} />
      </div>
      {detail ? <div className="figure mt-0.5 text-[11px] text-faint">{detail}</div> : null}
    </div>
  );
}

interface Line {
  id: string;
  from: 'crew' | 'base' | 'system';
  /** Who spoke, on a crew mission's radio. */
  who?: string;
  mine?: boolean;
  text: string;
  atUtcMs: number;
}

export function Chat({ world }: { world: World }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // On a crew mission everyone's calls go to the crew log, and the commander's browser passes them to the base.
  const radio = useCrew((s) => s.radio);
  const log = useCrew((s) => s.log);
  const myId = useCrew((s) => s.me?.clientId);
  const lines = useMemo<Line[]>(() => {
    if (!radio) return world.messages;
    const base = world.messages.filter((m) => m.from !== 'crew');
    const calls = log.filter((l) => l.kind === 'radio').map((l) => ({ id: l.id, from: 'crew' as const, who: l.authorName, mine: l.authorId === myId, text: l.text, atUtcMs: l.missionUtcMs ?? world.utcMs }));
    return [...base, ...calls].sort((a, b) => a.atUtcMs - b.atUtcMs);
  }, [radio, log, myId, world.messages, world.utcMs]);
  const [seen, setSeen] = useState(lines.length);
  const unread = open ? 0 : lines.slice(seen).filter((m) => m.from !== 'crew' || (radio && !m.mine)).length;
  const latest = lines.findLast((m) => m.from !== 'crew' || (radio && !m.mine));
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, lines.length]);
  const send = (line: string) => {
    if (radio) radio(line);
    else sayToBase(line);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSeen(lines.length);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="relative inline-flex h-9 max-w-[17rem] items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0">{radio ? 'Radio' : 'Talk to base'}</span>
          {latest && !open ? <span className="truncate font-normal text-muted-foreground max-md:hidden">{latest.text}</span> : null}
          {unread > 0 ? (
            <span className="figure absolute -top-1.5 -right-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
              {unread}
              <span className="sr-only"> new</span>
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={10} className="flex h-[min(26rem,60dvh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col p-0">
        <h2 className="border-b px-3.5 py-2.5 text-[13px] font-semibold">{radio ? 'Crew radio' : 'Radio'}</h2>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3.5 py-3" aria-live="polite">
          {lines.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {radio ? (
                <>
                  The whole crew hears what you say here. To call the base, start with <span translate="no" className="font-semibold text-primary">@Base</span>: it answers about air, power, time, the next stop, dust or radiation, from what the crew’s instruments say.
                </>
              ) : (
                'Ask the base about air, power, time, the next stop, dust or radiation. It answers from what the crew’s instruments say.'
              )}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2.5">
            {lines.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'max-w-[88%] text-[13px] leading-relaxed',
                  m.from === 'crew' ? (radio && !m.mine ? 'self-start rounded-md bg-secondary px-2.5 py-1.5' : 'self-end rounded-md bg-primary/15 px-2.5 py-1.5') : m.from === 'system' ? 'text-muted-foreground' : '',
                )}
              >
                {m.from === 'base' ? <span className="block text-[11px] font-medium text-faint">Base</span> : m.who && !m.mine ? <span className="block text-[11px] font-medium text-faint">{m.who}</span> : null}
                {radio && m.from === 'crew'
                  ? splitBaseCalls(m.text).map((part, i) =>
                      part.call ? (
                        <span key={i} translate="no" className="font-semibold text-primary">
                          {part.text}
                        </span>
                      ) : (
                        part.text
                      ),
                    )
                  : m.text}
              </li>
            ))}
          </ul>
          <div ref={end} />
        </div>
        <form
          className="flex gap-1.5 border-t p-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
            setText('');
          }}
        >
          {radio ? (
            <button
              type="button"
              aria-pressed={baseQuestion(text) !== null}
              title="Call the base: it answers calls that start with @Base"
              onClick={() => {
                setText((t) => (baseQuestion(t) !== null ? withoutBaseCall(t) : `@Base ${t.trimStart()}`));
                input.current?.focus();
              }}
              translate="no"
              className="h-9 shrink-0 rounded-md border px-2 text-[13px] font-semibold text-muted-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-1 focus-visible:ring-ring aria-pressed:border-primary/60 aria-pressed:bg-primary/15 aria-pressed:text-primary pointer-coarse:h-11"
            >
              @Base
            </button>
          ) : null}
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            name="message"
            autoComplete="off"
            aria-label={radio ? 'Message to the crew and base' : 'Message to base'}
            placeholder={radio ? 'Talk to the crew…' : 'How is our oxygen…'}
            maxLength={400}
            className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:h-11"
          />
          <button type="submit" disabled={!text.trim()} className="h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-40 pointer-coarse:h-11">
            Send
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function Outcome({ run }: { run: MissionRun }) {
  // A crew mission's end offers its debrief, once the commander's browser has filed it.
  const crewMission = useCrew((s) => s.current?.id ?? s.ended);
  const out = run.outcome;
  if (!out) return null;
  const verdict = (run.missionId ? missionById(run.missionId) : undefined)?.judge({
    tasksDone: out.tasksDone,
    tasksPlanned: out.tasksTotal,
    endedAt: out.kind === 'home' ? 'start' : out.kind === 'arrived' ? 'lastStop' : 'elsewhere',
    o2LeftFrac: out.o2Frac,
    batteryLeftFrac: out.batteryFrac,
    hours: out.durationS / 3600,
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold">{verdict ? (verdict.success ? 'Mission accomplished' : 'Mission not accomplished') : 'Mission over'}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">{verdict?.line ?? out.text}</p>
        <p className="figure mt-1 text-xs text-muted-foreground">
          {fmtDistance(out.distM)} in {fmtDuration(out.durationS)}, {out.tasksDone} of {out.tasksTotal} tasks done
          {out.o2Frac !== null ? `, ${fmtPercent(Math.max(0, out.o2Frac))} of the oxygen left` : ''}, {fmtNumber(out.doseMSv, 2)} mSv.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {crewMission ? (
          <button type="button" onClick={() => useCrew.setState({ debriefId: crewMission })} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            Read the debrief
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            closeMission();
            useCrew.setState({ ended: null });
          }}
          className="h-9 shrink-0 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground pointer-coarse:h-11"
        >
          Back to planning
        </button>
      </div>
    </div>
  );
}

/** The mission while it runs: what the crew is doing, how far along, what they have left, and the controls. */
export function RunPanel() {
  const world = useApp((s) => s.world);
  const watching = useCrew(watchingRun);
  const linkStale = useCrew((s) => s.linkStale);
  const run = world?.run;
  if (!world || !run) return null;
  const crew = crewAt(run, world.utcMs);
  const prog = progress(run, world.utcMs);
  const ltst = marsTime(world.utcMs, crew.lon).ltstH;
  const running = run.status === 'running';
  // On the whole mission's clock, like the bar itself: after a reroute the time already spent comes first.
  const stops = run.stopIndices.slice(1, -1).map((i) => (run.carry.timeS + (run.trip.samples[i]?.tS ?? 0)) / Math.max(1, run.carry.timeS + run.trip.totals.durationS));

  return (
    <section
      aria-label="Mission"
      className="panel pointer-events-auto absolute bottom-3 left-1/2 w-[min(47rem,calc(100vw-1.5rem))] -translate-x-1/2 px-4 py-3 max-md:bottom-[4.25rem] md:max-w-[calc(100vw-30rem)]"
    >
      {watching && linkStale && running ? (
        <p role="status" className="mb-2.5 rounded-md bg-caution/10 px-2.5 py-1.5 text-xs font-medium text-caution">
          Waiting for the commander’s link. The run shows where it was last heard.
        </p>
      ) : null}
      {!running ? (
        <Outcome run={run} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 max-md:basis-full">
              <p className="truncate text-[13.5px] font-semibold" aria-live="polite">
                {stateWords(run, crew, prog.nextName)}
              </p>
              <p className="figure mt-0.5 truncate text-xs text-muted-foreground">
                {fmtClock(ltst)} LTST
                {crew.state === 'move' ? `, ${fmtDistance(prog.nextDistM)} and ${fmtDuration(prog.nextS)} to go` : ''}, tasks {prog.tasksDone} of {prog.tasksTotal}
              </p>
            </div>
            {watching ? (
              <p className="shrink-0 text-xs text-muted-foreground">The commander decides speed and stops.</p>
            ) : (
              <>
                <div role="radiogroup" aria-label="Speed" className="flex shrink-0 gap-0.5 rounded-md border p-0.5">
                  {SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      role="radio"
                      aria-checked={world.speed === speed}
                      onClick={() => setRunSpeed(speed)}
                      className={cn('figure h-8 min-w-9 rounded px-1.5 text-xs font-semibold transition-colors pointer-coarse:h-10 pointer-coarse:min-w-10', world.speed === speed ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary')}
                    >
                      {speed}×
                    </button>
                  ))}
                </div>
                <button type="button" aria-label={world.paused ? 'Resume the mission' : 'Pause the mission'} onClick={toggleRunPaused} className="grid size-9 shrink-0 place-items-center rounded-md border transition-colors hover:bg-secondary pointer-coarse:size-11">
                  {world.paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
                </button>
                <button type="button" aria-label="End the mission" onClick={abortRun} className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground pointer-coarse:size-11">
                  <Square className="size-3.5" aria-hidden />
                </button>
              </>
            )}
          </div>

          <div className="relative mt-3 h-1.5 rounded-full bg-secondary" role="progressbar" aria-label="Mission progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.fraction * 100)}>
            <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${Math.max(0, Math.min(1, prog.fraction))})` }} />
            {stops.map((at, i) => (
              <span key={i} className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground/70" style={{ left: `${Math.max(0, Math.min(1, at)) * 100}%` }} aria-hidden />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Gauge label="Oxygen" frac={crew.o2Frac} {...(crew.o2Kg !== null ? { detail: `${fmtNumber(crew.o2Kg, 2)} kg` } : {})} />
              <Gauge label="Battery" frac={crew.batteryFrac} {...(crew.batteryKWh !== null ? { detail: `${fmtNumber(crew.batteryKWh, crew.batteryKWh < 10 ? 1 : 0)} kWh` } : {})} />
              <div className="min-w-[4.5rem]">
                <div className="text-xs text-muted-foreground">Dose</div>
                <div className="figure text-[13px] font-semibold">{fmtNumber(crew.doseMSv, 2)} mSv</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => useApp.getState().openVisor({ lon: crew.lon, lat: crew.lat, ride: true })}
                className="inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11"
              >
                <Binoculars className="size-4 text-muted-foreground" aria-hidden />
                Ride along
              </button>
              <Chat world={world} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
