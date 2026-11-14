/**
 * The debrief: a calm report of one mission. What was planned against what happened, the tasks and who did them,
 * everything that happened in mission time, the crew log, and the reader's own notes.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/components/ui/dialog';
import { auth } from '@/net/client';
import { fmtDelta, outcomeSentence, parseDebrief, tasksByStop, timelineOf, type Debrief, type TimelineEvent } from '@/net/debrief';
import { useCrew } from '@/net/state';
import { SEVERITY } from '@/ui/alerts/severity';
import { fmtDistance, fmtDuration, fmtNumber, fmtPercent, fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fmtLtst, fmtMarsMoment, vehicleName } from './format';
import { Notes } from './Notes';
import { StatusChip } from './parts';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const pct = (f: number | null) => (f === null ? 'n/a' : fmtPercent(Math.max(0, f)));

function Compare({ d }: { d: Debrief }) {
  const p = d.planned;
  const a = d.actual;
  const rows: { label: string; planned: string; actual: string; delta: string }[] = [
    { label: 'Duration', planned: p ? fmtDuration(p.durationS) : 'n/a', actual: a ? fmtDuration(a.durationS) : 'n/a', delta: fmtDelta('duration', p?.durationS ?? null, a?.durationS ?? null) },
    { label: 'Distance', planned: p ? fmtDistance(p.distM) : 'n/a', actual: a ? fmtDistance(a.distM) : 'n/a', delta: fmtDelta('distance', p?.distM ?? null, a?.distM ?? null) },
    { label: 'Oxygen left', planned: pct(p?.o2EndFrac ?? null), actual: pct(a?.o2Frac ?? null), delta: fmtDelta('fraction', p?.o2EndFrac ?? null, a?.o2Frac ?? null) },
    { label: 'Battery left', planned: pct(p?.batteryEndFrac ?? null), actual: pct(a?.batteryFrac ?? null), delta: fmtDelta('fraction', p?.batteryEndFrac ?? null, a?.batteryFrac ?? null) },
    { label: 'Dose', planned: p ? `${fmtNumber(p.doseMSv, 2)} mSv` : 'n/a', actual: a ? `${fmtNumber(a.doseMSv, 2)} mSv` : 'n/a', delta: fmtDelta('dose', p?.doseMSv ?? null, a?.doseMSv ?? null) },
  ].filter((r) => r.planned !== 'n/a' || r.actual !== 'n/a');
  return (
    <table className="figure w-full text-[13px]">
      <caption className="sr-only">Planned against actual</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="pb-1.5 font-medium" />
          <th scope="col" className="pb-1.5 font-medium">Planned</th>
          <th scope="col" className="pb-1.5 font-medium">Actual</th>
          <th scope="col" className="pb-1.5 text-right font-medium">Difference</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border/60">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
              {r.label}
            </th>
            <td className="py-1.5 pr-3">{r.planned}</td>
            <td className="py-1.5 pr-3 font-medium">{r.actual}</td>
            <td className="py-1.5 text-right text-muted-foreground">{r.delta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TASK_WORD = { todo: 'Not done', doing: 'Not finished', done: 'Done', skipped: 'Skipped' } as const;

function Tasks({ d }: { d: Debrief }) {
  const groups = useMemo(() => tasksByStop(d.tasks), [d.tasks]);
  if (groups.length === 0) return <p className="text-[13px] text-muted-foreground">The plan had no tasks.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {groups.map((g, k) => (
        <li key={`${g.stopName}-${k}`}>
          <p className="text-[13px] font-medium">{g.stopName}</p>
          <ul className="mt-1 flex flex-col">
            {g.tasks.map((t) => (
              <li key={t.id} className="flex items-baseline gap-3 border-t border-border/60 py-1.5 text-[13px] first:border-t-0">
                <span className="min-w-0 flex-1">{t.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t.assignee ?? 'Unassigned'}</span>
                <span className={cn('w-20 shrink-0 text-right text-xs font-medium', t.state === 'done' ? 'text-ok' : 'text-caution')}>{TASK_WORD[t.state]}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

const KIND_WORD: Record<TimelineEvent['kind'], string> = { start: 'Start', alert: 'Alert', route: 'Route', task: 'Task', radio: 'Radio', note: 'Note', system: 'Log', end: 'End', private: 'Your note' };

function Timeline({ events, d }: { events: TimelineEvent[]; d: Debrief }) {
  const t0 = d.startedUtcMs;
  if (events.length === 0) return <p className="text-[13px] text-muted-foreground">Nothing was logged in mission time.</p>;
  return (
    <ol className="relative ml-1.5 border-l pl-4">
      {events.map((e, i) => {
        const dot = e.kind === 'alert' && e.severity ? SEVERITY[e.severity].dot : e.kind === 'start' || e.kind === 'end' ? 'bg-primary' : e.kind === 'private' ? 'bg-foreground/60' : 'bg-faint';
        return (
          <li key={i} className="relative pb-3 last:pb-0">
            <span aria-hidden className={cn('absolute top-1.5 -left-[21px] size-2 rounded-full ring-2 ring-background', dot)} />
            <p className="figure text-[11px] text-faint">
              {t0 !== null ? `T+${fmtDuration(Math.max(0, (e.atUtcMs - t0) / 1000))}` : ''} · {fmtLtst(e.atUtcMs, d.lon)}
              <span className="ml-1.5 font-medium text-muted-foreground">{e.kind === 'alert' && e.severity ? SEVERITY[e.severity].word : KIND_WORD[e.kind]}</span>
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed">
              {e.who ? <span className="font-medium">{e.who}: </span> : null}
              {e.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function CrewLog({ d }: { d: Debrief }) {
  const lines = d.log.filter((l) => l.kind !== 'system');
  if (lines.length === 0) return <p className="text-[13px] text-muted-foreground">The crew wrote nothing in the log.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map((l, i) => (
        <li key={i} className="text-[13px] leading-relaxed">
          <span className="font-medium">{l.author}</span>
          {l.atUtcMs !== null ? <span className="figure ml-1.5 text-[11px] text-faint">{fmtLtst(l.atUtcMs, d.lon)}</span> : null}
          <span className="block text-foreground/90">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

function BaseRadio({ d }: { d: Debrief }) {
  const lines = d.messages.filter((m) => m.from !== 'crew');
  if (lines.length === 0) return null;
  return (
    <Block title="The base and the instruments">
      <ul className="flex flex-col gap-1.5">
        {lines.map((m, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-foreground/90">
            <span className="figure mr-1.5 text-[11px] text-faint">{fmtLtst(m.atUtcMs, d.lon)}</span>
            {m.text}
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Report({ missionId }: { missionId: Id<'missions'> }) {
  const data = useQuery(api.missions.get, { missionId, ...auth() });
  const notes = useQuery(api.notes.list, { auth: auth(), missionId });
  const debrief = useMemo(() => parseDebrief(data?.mission.debriefJson ?? null), [data?.mission.debriefJson]);
  const events = useMemo(() => (debrief ? timelineOf(debrief, notes ?? []) : []), [debrief, notes]);

  if (data === undefined) return <p className="px-6 py-6 text-[13px] text-muted-foreground">Loading the debrief…</p>;
  if (!data || !debrief) {
    return (
      <div className="px-6 py-6">
        <DialogTitle className="text-[17px]">Debrief</DialogTitle>
        <DialogDescription className="mt-2 text-[13px]">{data && data.mission.status === 'underway' ? 'The mission is still under way. The debrief is written when it ends.' : data && data.mission.status === 'aborted' ? 'This mission ended without its commander, so no debrief was written. The crew log says what happened.' : 'There is no debrief for this mission.'}</DialogDescription>
      </div>
    );
  }
  const status = data.mission.status;
  const started = debrief.startedUtcMs;
  return (
    <>
      <header className="px-6 pt-6 pb-5">
        <div className="flex items-start gap-3 pr-8">
          <DialogTitle className="min-w-0 flex-1 text-[19px] leading-snug font-semibold tracking-[-0.01em]">{debrief.title}</DialogTitle>
          <StatusChip status={status} {...(started === null && status === 'aborted' ? { label: 'Cancelled' } : {})} />
        </div>
        <DialogDescription className="mt-2 text-[14px] leading-relaxed text-foreground/90">{outcomeSentence(debrief)}</DialogDescription>
        <p className="figure mt-2 text-xs text-muted-foreground">
          {started !== null ? `${fmtMarsMoment(started, debrief.lon)} · ${fmtUtc(started, true)}` : 'Did not set out'} · {vehicleName(debrief.vehicle)}
          {debrief.siteName ? ` from ${debrief.siteName}` : ''}
        </p>
        {debrief.objective ? <p className="mt-2 text-[13px] text-muted-foreground">Objective: {debrief.objective}</p> : null}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Crew">
          {debrief.crew.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className="size-2.5 rounded-full ring-1 ring-black/30" style={{ backgroundColor: c.color }} />
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {c.role}
                {c.android ? ', android' : ''}
                {c.left ? ', left during the run' : ''}
              </span>
            </li>
          ))}
        </ul>
      </header>

      {started !== null ? (
        <>
          <Block title="Planned and actual">
            {debrief.plannedStartUtc !== null && started !== null ? (
              <p className="figure mb-3 text-xs text-muted-foreground">
                Planned departure {fmtMarsMoment(debrief.plannedStartUtc, debrief.lon)}; set out {fmtMarsMoment(started, debrief.lon)}
                {Math.abs(started - debrief.plannedStartUtc) >= 60_000 ? ` (${fmtDelta('duration', debrief.plannedStartUtc / 1000, started / 1000)})` : ', on time'}.
              </p>
            ) : null}
            <Compare d={debrief} />
            <p className="mt-2 text-xs text-muted-foreground">
              {debrief.routeChanges === 0 ? 'The crew kept to the planned route.' : `The route changed ${debrief.routeChanges === 1 ? 'once' : `${debrief.routeChanges} times`} on the way.`}
              {debrief.actual ? ` ${debrief.actual.tasksDone} of ${debrief.actual.tasksTotal} tasks done.` : ''}
            </p>
          </Block>

          <Block title="Tasks">
            <Tasks d={debrief} />
          </Block>

          <Block title="Timeline, in mission time">
            <Timeline events={events} d={debrief} />
          </Block>
        </>
      ) : null}

      <Block title="Crew log">
        <CrewLog d={debrief} />
      </Block>

      <BaseRadio d={debrief} />

      <Block title="Your notes">
        <Notes missionId={missionId} lon={debrief.lon} />
      </Block>
    </>
  );
}

export default function DebriefDialog() {
  const missionId = useCrew((s) => s.debriefId);
  return (
    <Dialog open={missionId !== null} onOpenChange={(open) => !open && useCrew.setState({ debriefId: null })}>
      <DialogContent className="scroll-quiet block max-h-[88dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">{missionId ? <Report missionId={missionId} /> : null}</DialogContent>
    </Dialog>
  );
}
