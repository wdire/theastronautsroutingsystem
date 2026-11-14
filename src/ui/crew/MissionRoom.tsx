/**
 * The mission room: one mission, while it is planned and while it runs. The commander shapes it here (title,
 * departure, crew, who does which task) and starts it; everyone else sees the same, read-only, and keeps their
 * own checklist and notes.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowDown, ArrowUp, Bot, ChevronDown, Pencil, Play, Plus, Route, X } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { COMMANDER_ROLE, DEFAULT_ROLE, LIMITS, MAX_CREW, ROLE_PRESETS, SUIT_COLOR_HEX, type CrewColor } from '../../../convex/shared';
import { marsTime, nextLtst, SOL_MS } from '@/engines/marsTime';
import type { VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { useApp, TASK_NAME } from '@/store';
import { auth, toastError } from '@/net/client';
import { buildDebrief } from '@/net/debrief';
import { preEvaChecklist } from '@/net/checklist';
import type { CrewRow, MissionData } from '@/net/mission';
import { parsePlan } from '@/net/planSync';
import { useCrew } from '@/net/state';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { fmtClock, fmtNumber, fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { stopLabel } from '@/planner/labels';
import { fmtFromNow, fmtMarsMoment, vehicleName } from './format';
import { CrewMark, FIELD, Heading, ICON_BTN, PRIMARY_BTN, QUIET_BTN, StatusChip } from './parts';
import { Notes } from './Notes';
import { OnlineNow } from './Online';
import { useChecklist } from './useChecklist';
import { useNow } from './useNow';

type Mutate = Promise<unknown>;
function run(p: Mutate): void {
  p.catch(toastError);
}

/* ---------- title and objective ---------- */

function TitleBlock({ data }: { data: MissionData }) {
  const update = useMutation(api.missions.update);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const m = data.mission;
  const commander = data.crew.find((c) => c.personId === m.commanderId);
  const canEdit = data.isCommander && m.status === 'planning';

  if (editing) {
    return (
      <form
        className="flex flex-col gap-2 px-4 pt-3 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(update({ auth: auth(), missionId: m._id, title, objective }).then(() => setEditing(false)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Mission title" maxLength={LIMITS.title} className={FIELD} />
        <input value={objective} onChange={(e) => setObjective(e.target.value)} aria-label="Objective" placeholder="Objective in one line" maxLength={LIMITS.objective} className={FIELD} />
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY_BTN} disabled={!title.trim()}>
            Save
          </button>
          <button type="button" className={QUIET_BTN} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">{m.title}</h3>
        <StatusChip status={m.status} />
        {canEdit ? (
          <button
            type="button"
            aria-label="Edit the title and objective"
            className={cn(ICON_BTN, '-mt-1.5 -mr-1.5')}
            onClick={() => {
              setTitle(m.title);
              setObjective(m.objective);
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {m.objective ? <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{m.objective}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {commander ? `${commander.name} commands` : 'No commander'}, {vehicleName(m.vehicle)}
        {m.siteName ? ` from ${m.siteName}` : ''}.
      </p>
    </div>
  );
}

/* ---------- departure ---------- */

const SOL_CHOICES = 5;

/** The next few sols at a longitude, each with the moment its local midnight begins. */
function solChoices(nowMs: number, lon: number): { sol: number; midnightUtc: number; word: string }[] {
  const nextMidnight = nextLtst(nowMs, lon, 0);
  const today = nextMidnight - SOL_MS;
  return Array.from({ length: SOL_CHOICES }, (_, k) => {
    const midnightUtc = today + k * SOL_MS;
    const sol = Math.floor(marsTime(midnightUtc + SOL_MS / 2, lon).sol);
    return { sol, midnightUtc, word: k === 0 ? 'today' : k === 1 ? 'tomorrow' : `in ${k} sols` };
  });
}

function DepartureBlock({ data, lon }: { data: MissionData; lon: number }) {
  const planned = data.mission.plannedStartUtc;
  const route = useApp((s) => s.route);
  const setDepart = useApp((s) => s.setDepartUtcMs);
  const now = useNow(30_000);
  const [solIndex, setSolIndex] = useState(1);
  const [time, setTime] = useState('07:30');
  const canEdit = data.isCommander && data.mission.status === 'planning';
  const choices = useMemo(() => solChoices(now, lon), [now, lon]);
  const autoDepart = route.status === 'ready' ? route.departUtcMs : null;
  const pick = choices[solIndex] ?? choices[0];
  const [hh = 7, mm = 30] = time.split(':').map(Number);
  const chosenUtc = pick ? nextLtst(pick.midnightUtc, lon, hh + mm / 60) : null;

  if (data.mission.status !== 'planning') return null;
  return (
    <section className="border-t px-4 py-4" aria-labelledby="room-depart">
      <Heading>
        <span id="room-depart">Planned departure</span>
      </Heading>
      {planned !== null ? (
        <div>
          <p className="figure text-[13.5px] font-semibold">{fmtMarsMoment(planned, lon)}</p>
          <p className="figure mt-0.5 text-xs text-muted-foreground">
            {fmtUtc(planned, true)} · <span aria-live="polite">{planned > now ? `departs ${fmtFromNow(planned, now)}` : 'due now'}</span>
          </p>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Not set.{' '}
          {autoDepart !== null
            ? `The plan leaves at the first good morning, ${fmtMarsMoment(autoDepart, lon)} (${fmtFromNow(autoDepart, now)}).`
            : 'The plan leaves at the first morning the trip fits in daylight.'}
        </p>
      )}
      {canEdit ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-1.5">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Sol</span>
              <select value={solIndex} onChange={(e) => setSolIndex(Number(e.target.value))} className={cn(FIELD, 'figure bg-background')}>
                {choices.map((c, i) => (
                  <option key={c.sol} value={i}>
                    Sol {fmtNumber(c.sol)}, {c.word}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[6.5rem] shrink-0">
              <span className="sr-only">Local true solar time</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(FIELD, 'figure')} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={QUIET_BTN}
              disabled={chosenUtc === null || chosenUtc < now}
              onClick={() => chosenUtc !== null && setDepart(chosenUtc)}
            >
              Set {fmtClock(hh + mm / 60)} LTST
            </button>
            {autoDepart !== null && planned === null ? (
              <button type="button" className={QUIET_BTN} onClick={() => setDepart(autoDepart)}>
                Use the first good morning
              </button>
            ) : null}
            {planned !== null ? (
              <button type="button" className={QUIET_BTN} onClick={() => setDepart(null)}>
                Clear
              </button>
            ) : null}
          </div>
          {chosenUtc !== null && chosenUtc < now ? <p className="text-xs text-caution">That time has passed. Pick a later one.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- crew ---------- */

function RoleMenu({ row, onRole }: { row: CrewRow; onRole: (role: string) => void }) {
  const [custom, setCustom] = useState<string | null>(null);
  if (custom !== null) {
    return (
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) onRole(custom.trim());
          setCustom(null);
        }}
      >
        <input autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => setCustom(null)} aria-label={`Role for ${row.name}`} maxLength={LIMITS.role} className={cn(FIELD, 'h-7 text-xs')} />
      </form>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Role of ${row.name}: ${row.role}. Change role`} className="inline-flex max-w-full items-center gap-1 rounded px-1 -ml-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <span className="truncate">{row.role}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {ROLE_PRESETS.filter((r) => r !== COMMANDER_ROLE).map((r) => (
          <DropdownMenuItem key={r} onSelect={() => onRole(r)}>
            {r}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCustom(row.role)}>Another role…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RosterBlock({ data }: { data: MissionData }) {
  const update = useMutation(api.crew.update);
  const remove = useMutation(api.crew.remove);
  const addAndroid = useMutation(api.crew.addAndroid);
  const m = data.mission;
  const planning = m.status === 'planning';
  const edit = data.isCommander && planning;
  const rows = useMemo(() => data.crew.filter((c) => c.state !== 'left').sort((a, b) => a.order - b.order), [data.crew]);
  const seats = rows.length;

  const swap = (i: number, j: number) => {
    const a = rows[i];
    const b = rows[j];
    if (!a || !b) return;
    // Orders need not be dense, so swapping the two numbers is enough to swap places.
    run(Promise.all([update({ auth: auth(), missionId: m._id, crewId: a._id, order: b.order }), update({ auth: auth(), missionId: m._id, crewId: b._id, order: a.order })]));
  };

  return (
    <section className="border-t px-4 py-4" aria-labelledby="room-crew">
      <Heading aside={`${seats} of ${MAX_CREW}`}>
        <span id="room-crew">Crew, in walking order</span>
      </Heading>
      <ol className="flex flex-col">
        {rows.map((c, i) => {
          const isCmdr = c.personId === m.commanderId;
          const android = c.kind === 'android';
          return (
            <li key={c._id} className="flex items-center gap-2.5 border-t border-border/60 py-1.5 first:border-t-0">
              <CrewMark color={c.color as CrewColor} android={android} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{c.name}</span>
                  {android ? <span className="shrink-0 rounded bg-secondary px-1 py-px text-[10.5px] font-semibold text-foreground/80">Android</span> : null}
                  {c.state === 'invited' ? <span className="shrink-0 text-[11px] text-faint">invited</span> : null}
                  {c.personId === auth().clientId ? <span className="shrink-0 text-[11px] text-faint">you</span> : null}
                </span>
                {edit && !isCmdr ? <RoleMenu row={c} onRole={(role) => run(update({ auth: auth(), missionId: m._id, crewId: c._id, role }))} /> : <span className="block truncate text-xs text-muted-foreground">{c.role}</span>}
              </span>
              {edit ? (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={ICON_BTN} aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className={ICON_BTN} aria-label={`Move ${c.name} down`} disabled={i === rows.length - 1} onClick={() => swap(i, i + 1)}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" className={ICON_BTN} aria-label={c.state === 'invited' ? `Withdraw the invite to ${c.name}` : `Take ${c.name} off the crew`} disabled={isCmdr} onClick={() => run(remove({ auth: auth(), missionId: m._id, crewId: c._id }))}>
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {edit ? (
        <button type="button" className={cn(QUIET_BTN, 'mt-2')} disabled={seats >= MAX_CREW} onClick={() => run(addAndroid({ auth: auth(), missionId: m._id, role: DEFAULT_ROLE }))}>
          <Bot className="size-3.5 text-muted-foreground" aria-hidden />
          Add an android
        </button>
      ) : null}
    </section>
  );
}

/* ---------- the plan and its tasks ---------- */

function AssignMenu({ data, taskId, label }: { data: MissionData; taskId: string; label: string }) {
  const assign = useMutation(api.missions.assign);
  const crewId = data.mission.assignments[taskId];
  const who = crewId ? data.crew.find((c) => c._id === crewId) : undefined;
  const joined = data.crew.filter((c) => c.state === 'joined').sort((a, b) => a.order - b.order);
  const canAssign = data.isCommander && (data.mission.status === 'planning' || data.mission.status === 'underway');
  const shown = (
    <>
      {who ? <CrewMark color={who.color as CrewColor} android={who.kind === 'android'} /> : null}
      <span className={cn('truncate', !who && 'text-faint')}>{who?.name ?? 'No one yet'}</span>
    </>
  );
  if (!canAssign) return <span className="flex min-w-0 items-center gap-1.5 text-xs">{shown}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${label}: ${who ? `assigned to ${who.name}` : 'not assigned'}. Assign`} className="flex min-w-0 max-w-[9.5rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-secondary">
          {shown}
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {joined.map((c) => (
          <DropdownMenuItem key={c._id} onSelect={() => run(assign({ auth: auth(), missionId: data.mission._id, taskId, crewId: c._id }))} className="gap-2">
            <CrewMark color={c.color as CrewColor} android={c.kind === 'android'} />
            {c.name}
          </DropdownMenuItem>
        ))}
        {crewId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run(assign({ auth: auth(), missionId: data.mission._id, taskId, crewId: null }))}>No one</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TASK_STATE_WORD = { todo: 'To do', doing: 'Under way', done: 'Done', skipped: 'Skipped' } as const;

function PlanBlock({ data }: { data: MissionData }) {
  const shared = useMemo(() => parsePlan(data.mission.planJson), [data.mission.planJson]);
  const runTasks = useApp((s) => s.world?.run?.tasks);
  const route = useApp((s) => s.route);
  const start = useCrew((s) => s.start);
  const [starting, setStarting] = useState(false);
  const planning = data.mission.status === 'planning';
  const plan = shared?.plan;
  const stateOf = useMemo(() => new Map((runTasks ?? []).map((t) => [t.id, t.state])), [runTasks]);
  const taskCount = plan?.stops.reduce((n, s) => n + s.tasks.length, 0) ?? 0;
  const ready = route.status === 'ready' && route.hasBudget;

  const openPlanner = () => {
    useApp.getState().openDock(null);
    useApp.getState().openPlanner(true);
  };

  return (
    <section className="border-t px-4 py-4" aria-labelledby="room-plan">
      <Heading aside={plan ? `${plan.stops.length} ${plan.stops.length === 1 ? 'stop' : 'stops'}, ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}` : undefined}>
        <span id="room-plan">Route and tasks</span>
      </Heading>
      {planning ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className={QUIET_BTN} onClick={openPlanner}>
            <Route className="size-3.5 text-muted-foreground" aria-hidden />
            {data.isCommander ? 'Edit the route' : 'See the route'}
          </button>
          {!data.isCommander ? <span className="text-xs text-muted-foreground">The commander plans the route.</span> : null}
        </div>
      ) : null}
      {!plan || plan.stops.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No stops yet. {data.isCommander ? 'Add them in the mission plan.' : ''}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {plan.stops.map((stop, k) => (
            <li key={stop.id}>
              <p className="text-[13px] font-medium">
                <span className="figure mr-1.5 text-muted-foreground">{k + 1}</span>
                {stopLabel(stop)}
              </p>
              {stop.tasks.length === 0 ? (
                <p className="mt-0.5 ml-4 text-xs text-faint">No tasks here.</p>
              ) : (
                <ul className="mt-1 ml-4 flex flex-col">
                  {stop.tasks.map((t) => {
                    const label = t.label ?? TASK_NAME[t.kind];
                    const state = stateOf.get(`${stop.id}:${t.id}`);
                    return (
                      <li key={t.id} className="flex items-center gap-2 border-t border-border/60 py-1.5 first:border-t-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{label}</span>
                          <span className="figure block text-xs text-muted-foreground">
                            {t.minutes} min{state ? ` · ${TASK_STATE_WORD[state]}` : ''}
                          </span>
                        </span>
                        <AssignMenu data={data} taskId={t.id} label={label} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {planning && data.isCommander ? (
        <div className="mt-4">
          <button
            type="button"
            className={PRIMARY_BTN}
            disabled={!ready || !start || starting}
            onClick={() => {
              if (!start) return;
              setStarting(true);
              void start().finally(() => setStarting(false));
            }}
          >
            <Play className="size-3.5" aria-hidden />
            {starting ? 'Starting…' : 'Start the mission'}
          </button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {ready ? 'Starts the run for the whole crew. Open invites lapse.' : route.status === 'routing' ? 'Working out the route…' : 'The route must be worked out, with its budget, before the mission can start.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- checklist ---------- */

function ChecklistBlock({ data }: { data: MissionData }) {
  const vehicleId = (data.mission.vehicle in VEHICLES ? data.mission.vehicle : 'foot') as VehicleId;
  const totals = useApp((s) => {
    if (s.route.status !== 'ready') return null;
    const alt = s.route.alternatives.find((a) => a.id === (s.route.status === 'ready' ? s.route.selected : '')) ?? s.route.alternatives[0];
    return alt && s.route.hasBudget ? alt.trip.totals : null;
  });
  const items = useMemo(() => preEvaChecklist(VEHICLES[vehicleId], totals), [vehicleId, totals]);
  const [ticked, toggle] = useChecklist(data.mission._id);
  const done = items.filter((i) => ticked.has(i.id)).length;
  if (data.mission.status !== 'planning') return null;
  return (
    <section className="border-t px-4 py-4" aria-labelledby="room-check">
      <Heading aside={`${done} of ${items.length}`}>
        <span id="room-check">Your pre-EVA checklist</span>
      </Heading>
      <ul className="flex flex-col">
        {items.map((item) => {
          const on = ticked.has(item.id);
          return (
            <li key={item.id}>
              <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(item.id)} className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary">
                <span aria-hidden className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                  {on ? <svg viewBox="0 0 12 12" className="size-3"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-[13px] font-medium', on && 'text-muted-foreground line-through decoration-faint')}>{item.text}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{item.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-faint">Ticks are yours alone and stay in this browser.</p>
    </section>
  );
}

/* ---------- command and leaving ---------- */

function CommandBlock({ data }: { data: MissionData }) {
  const transfer = useMutation(api.missions.transferCommand);
  const finish = useMutation(api.missions.finish);
  const leave = useMutation(api.crew.leave);
  const [confirm, setConfirm] = useState(false);
  const m = data.mission;
  const planning = m.status === 'planning';
  const humans = data.crew.filter((c) => c.kind === 'human' && c.state === 'joined' && c.personId !== m.commanderId);

  if (!data.isCommander) {
    if (!data.isCrew) return null;
    return (
      <section className="border-t px-4 py-4">
        <button type="button" className={QUIET_BTN} onClick={() => run(leave({ auth: auth(), missionId: m._id }))}>
          Leave the mission
        </button>
        {m.status === 'underway' ? <p className="mt-1.5 text-xs text-muted-foreground">The run goes on without you; your name stays in its log.</p> : null}
      </section>
    );
  }
  if (!planning) return null;

  const cancel = () => {
    const s = useApp.getState();
    const debrief = buildDebrief({
      mission: { title: m.title, objective: m.objective, vehicle: m.vehicle, siteName: m.siteName, plannedStartUtc: m.plannedStartUtc },
      crew: data.crew,
      assignments: m.assignments,
      world: null,
      planned: null,
      log: useCrew.getState().log.map((l) => ({ authorName: l.authorName, kind: l.kind, text: l.text, missionUtcMs: l.missionUtcMs })),
      colorOf: (c) => SUIT_COLOR_HEX[c as CrewColor] ?? SUIT_COLOR_HEX.graphite,
      fallbackLon: s.plan.start?.lon ?? 0,
    });
    run(finish({ auth: auth(), missionId: m._id, status: 'aborted', debriefJson: JSON.stringify(debrief) }));
  };

  return (
    <section className="flex flex-wrap items-center gap-2 border-t px-4 py-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={QUIET_BTN} disabled={humans.length === 0}>
            Hand over command
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {humans.map((c) => (
            <DropdownMenuItem key={c._id} onSelect={() => run(transfer({ auth: auth(), missionId: m._id, toCrewId: c._id as Id<'crew'> }))} className="gap-2">
              <CrewMark color={c.color as CrewColor} android={false} />
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirm ? (
        <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Cancel the mission">
          <span className="text-xs text-muted-foreground">Cancel it for the whole crew?</span>
          <button type="button" className={cn(QUIET_BTN, 'border-warning/60 text-warning')} onClick={cancel}>
            Cancel the mission
          </button>
          <button type="button" className={QUIET_BTN} onClick={() => setConfirm(false)}>
            Keep it
          </button>
        </span>
      ) : (
        <button type="button" className={QUIET_BTN} onClick={() => setConfirm(true)}>
          Cancel the mission
        </button>
      )}
    </section>
  );
}

export function MissionRoom({ missionId }: { missionId: Id<'missions'> }) {
  const data = useQuery(api.missions.get, { missionId, ...auth() });
  const lon = useApp((s) => s.plan.start?.lon ?? s.world?.run?.home[0] ?? 77.45);
  const crewIds = useMemo(() => new Set((data?.crew ?? []).filter((c) => c.state !== 'left' && c.personId).map((c) => c.personId as string)), [data?.crew]);
  if (data === undefined) return <p className="border-t px-4 py-4 text-[13px] text-muted-foreground">Loading the mission…</p>;
  if (data === null) return <p className="border-t px-4 py-4 text-[13px] text-muted-foreground">This mission no longer exists.</p>;
  const planning = data.mission.status === 'planning';
  return (
    <div className="border-t">
      <TitleBlock data={data} />
      <DepartureBlock data={data} lon={lon} />
      <RosterBlock data={data} />
      <PlanBlock data={data} />
      <ChecklistBlock data={data} />
      <section className="border-t px-4 py-4" aria-labelledby="room-notes">
        <Heading>
          <span id="room-notes">Your notes</span>
        </Heading>
        <Notes missionId={data.mission._id} />
      </section>
      <CommandBlock data={data} />
      <OnlineNow missionId={data.mission._id} crewIds={crewIds} canInvite={data.isCommander && planning} />
      {planning && data.isCommander ? <InviteHint /> : null}
    </div>
  );
}

function InviteHint() {
  return (
    <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-faint">
      <Plus className="size-3" aria-hidden />
      Invite people from the list above. They join with the role {DEFAULT_ROLE}; change it in the crew list.
    </p>
  );
}
