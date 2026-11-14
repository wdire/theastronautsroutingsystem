/**
 * The Crew panel: who the visitor is to others, invites, the mission they are in (or the ones they could join,
 * or start), who else is online, and the debriefs of missions flown. Loaded only with a crew server.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowRight, FileText, Pencil, Route } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { LIMITS, MAX_CREW, SUIT_COLORS, type SuitColor } from '../../../convex/shared';
import { useApp } from '@/store';
import { stopLabel } from '@/planner/labels';
import { auth, toastError } from '@/net/client';
import { cleanName, loadIdentity, saveIdentity } from '@/net/identity';
import { encodePlan } from '@/net/planSync';
import { useCrew } from '@/net/state';
import { OnlineNow } from './Online';
import { fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { fmtFromNow, fmtMarsMoment, vehicleName } from './format';
import { FIELD, Heading, PRIMARY_BTN, QUIET_BTN, StatusChip, Swatch } from './parts';
import { MissionRoom } from './MissionRoom';
import { useNow } from './useNow';

const SWATCH_NAME: Record<SuitColor, string> = { signal: 'Signal orange', flare: 'Flare red', ochre: 'Ochre', lichen: 'Lichen green', glacier: 'Glacier teal', cobalt: 'Cobalt blue', iris: 'Iris violet', chalk: 'Chalk white' };

function ColorPicker({ value, onChange, disabled }: { value: SuitColor; onChange: (c: SuitColor) => void; disabled?: boolean }) {
  const move = (dir: number) => {
    const i = SUIT_COLORS.indexOf(value);
    const next = SUIT_COLORS[(i + dir + SUIT_COLORS.length) % SUIT_COLORS.length];
    if (next) onChange(next);
  };
  return (
    <div
      role="radiogroup"
      aria-label="Suit colour"
      className="flex flex-wrap gap-1.5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(-1);
        else return;
        e.preventDefault();
        // Focus follows the choice, as in any radio group.
        requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus());
      }}
    >
      {SUIT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={SWATCH_NAME[c]}
          title={SWATCH_NAME[c]}
          tabIndex={c === value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn('grid size-7 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9', c === value ? 'ring-2 ring-foreground/80 ring-offset-2 ring-offset-background' : 'hover:ring-1 hover:ring-foreground/40')}
        >
          <Swatch color={c} className="size-5" />
        </button>
      ))}
    </div>
  );
}

/** The visitor's callsign and suit colour, editable in place. */
function You() {
  const me = useCrew((s) => s.me);
  const rename = useMutation(api.people.rename);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!me) return null;

  const save = (nextName: string, color: SuitColor) => {
    const clean = cleanName(nextName);
    if (!clean) return;
    const id = loadIdentity();
    const before = useCrew.getState().me;
    saveIdentity({ ...id, name: clean, color });
    useCrew.setState({ me: { ...me, name: clean, color } });
    rename({ clientId: id.clientId, secret: id.secret, name: clean, color }).catch((err) => {
      useCrew.setState({ me: before });
      saveIdentity(id);
      toastError(err);
    });
  };

  return (
    <section className="px-4 pt-3 pb-4" aria-labelledby="crew-you">
      <Heading>
        <span id="crew-you">You</span>
      </Heading>
      {editing ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save(name, me.color);
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            aria-label="Callsign"
            maxLength={LIMITS.name}
            className={FIELD}
          />
          <button type="submit" disabled={!cleanName(name)} className={PRIMARY_BTN}>
            Save
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-2.5">
          <Swatch color={me.color} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{me.name}</span>
          <button
            type="button"
            className={QUIET_BTN}
            onClick={() => {
              setName(me.name);
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
            Rename
          </button>
        </div>
      )}
      <div className="mt-3">
        <ColorPicker value={me.color} onChange={(c) => save(me.name, c)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Others see you by this name and the band on your suit.</p>
    </section>
  );
}

function Invites() {
  const me = auth();
  const invites = useQuery(api.crew.invitesFor, me);
  const respond = useMutation(api.crew.respond);
  const [busy, setBusy] = useState<string | null>(null);
  if (!invites || invites.length === 0) return null;
  const answer = (missionId: Id<'missions'>, accept: boolean) => {
    setBusy(missionId);
    respond({ auth: me, missionId, accept })
      .catch(toastError)
      .finally(() => setBusy(null));
  };
  return (
    <section className="border-t px-4 py-4" aria-labelledby="crew-invites">
      <Heading>
        <span id="crew-invites">Invites</span>
      </Heading>
      <ul className="flex flex-col gap-2">
        {invites.map((inv) => (
          <li key={inv.crewId} className="rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-[13.5px] font-semibold">{inv.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {inv.commanderName} asks you to join as {inv.role}.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" className={PRIMARY_BTN} disabled={busy === inv.missionId} onClick={() => answer(inv.missionId, true)}>
                Accept
              </button>
              <button type="button" className={QUIET_BTN} disabled={busy === inv.missionId} onClick={() => answer(inv.missionId, false)}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateMission() {
  const start = useApp((s) => s.plan.start);
  const stops = useApp((s) => s.plan.stops.length);
  const vehicle = useApp((s) => s.plan.vehicle);
  const create = useMutation(api.missions.create);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);

  const openPlanner = () => {
    useApp.getState().openDock(null);
    useApp.getState().openPlanner(true);
  };

  return (
    <section className="border-t px-4 py-4" aria-labelledby="crew-create">
      <Heading>
        <span id="crew-create">Create a mission</span>
      </Heading>
      {!start ? (
        <div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">A crew mission takes the plan from the planner. The plan has no start yet.</p>
          <button type="button" className={cn(QUIET_BTN, 'mt-2')} onClick={openPlanner}>
            <Route className="size-3.5 text-muted-foreground" aria-hidden />
            Open the mission plan
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const s = useApp.getState();
            setBusy(true);
            create({
              auth: auth(),
              title,
              objective,
              planJson: encodePlan({ plan: s.plan, templateId: s.missionId }),
              vehicle: s.plan.vehicle,
              ...(s.plan.start?.name ? { siteName: s.plan.start.name.slice(0, LIMITS.siteName) } : {}),
            })
              .then(() => {
                setTitle('');
                setObjective('');
              })
              .catch(toastError)
              .finally(() => setBusy(false));
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Mission title" placeholder="Title, e.g. Delta front survey" maxLength={LIMITS.title} className={FIELD} />
          <input value={objective} onChange={(e) => setObjective(e.target.value)} aria-label="Objective" placeholder="Objective in one line" maxLength={LIMITS.objective} className={FIELD} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Uses the current plan: {vehicleName(vehicle)} from {stopLabel(start)}, {stops} {stops === 1 ? 'stop' : 'stops'}. You will command it.
          </p>
          <div>
            <button type="submit" className={PRIMARY_BTN} disabled={busy || !title.trim()}>
              Create the mission
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function OpenMissions() {
  const missions = useQuery(api.missions.list, {});
  const join = useMutation(api.crew.join);
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const lon = useApp((s) => s.plan.start?.lon ?? 77.45);
  const open = useMemo(() => (missions ?? []).filter((m) => m.status === 'planning' || m.status === 'underway'), [missions]);

  return (
    <section className="border-t px-4 py-4" aria-labelledby="crew-open">
      <Heading aside={open.length > 0 ? `${open.length}` : undefined}>
        <span id="crew-open">Missions you can join</span>
      </Heading>
      {missions === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : open.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No missions are being planned right now. Create one and invite whoever is online.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((m) => (
            <li key={m._id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[13.5px] font-semibold">{m.title}</p>
                <StatusChip status={m.status} />
              </div>
              {m.objective ? <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">{m.objective}</p> : null}
              <p className="figure mt-1 text-xs text-muted-foreground">
                {m.commanderName} commands, {m.crewCount} of {MAX_CREW} crew, {vehicleName(m.vehicle)}
              </p>
              {m.plannedStartUtc !== null ? (
                <p className="figure mt-0.5 text-xs text-muted-foreground">
                  Departs {fmtMarsMoment(m.plannedStartUtc, lon)}, {fmtFromNow(m.plannedStartUtc, now)}
                </p>
              ) : null}
              {m.open ? (
                <button
                  type="button"
                  className={cn(QUIET_BTN, 'mt-2.5')}
                  disabled={busy === m._id}
                  onClick={() => {
                    setBusy(m._id);
                    join({ auth: auth(), missionId: m._id })
                      .catch(toastError)
                      .finally(() => setBusy(null));
                  }}
                >
                  Join
                </button>
              ) : (
                <p className="mt-2 text-xs text-faint">Closed to new crew. The commander can invite you.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PastMissions() {
  const mine = useQuery(api.missions.mine, auth());
  const past = mine?.past ?? [];
  if (past.length === 0) return null;
  return (
    <section className="border-t px-4 py-4" aria-labelledby="crew-past">
      <Heading>
        <span id="crew-past">Past missions</span>
      </Heading>
      <ul className="flex flex-col gap-1">
        {past.map((p) => (
          <li key={p.missionId}>
            <button type="button" onClick={() => useCrew.setState({ debriefId: p.missionId })} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.title}</span>
                <span className="figure block text-xs text-muted-foreground">{fmtUtc(p.endedAt, true)}</span>
              </span>
              <StatusChip status={p.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A run that just ended under the visitor: its debrief is one click away. */
function JustEnded({ missionId }: { missionId: Id<'missions'> }) {
  const data = useQuery(api.missions.get, { missionId, ...auth() });
  if (!data) return null;
  return (
    <section className="border-t px-4 py-4">
      <div className="rounded-md border p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13.5px] font-semibold">{data.mission.title}</p>
          <StatusChip status={data.mission.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{data.mission.status === 'underway' ? 'The mission is ending.' : 'The mission is over. The debrief is ready.'}</p>
        <div className="mt-2.5 flex gap-2">
          <button type="button" className={PRIMARY_BTN} disabled={!data.mission.debriefJson} onClick={() => useCrew.setState({ debriefId: missionId })}>
            Read the debrief
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
          <button type="button" className={QUIET_BTN} onClick={() => useCrew.setState({ ended: null })}>
            Put away
          </button>
        </div>
      </div>
    </section>
  );
}

export default function CrewPanel() {
  const me = useCrew((s) => s.me);
  const current = useCrew((s) => s.current);
  const ended = useCrew((s) => s.ended);
  if (!me) return <p className="px-4 py-4 text-[13px] text-muted-foreground">Connecting to the crew server…</p>;
  return (
    <div className="pb-2">
      <You />
      {current ? (
        <MissionRoom missionId={current.id} />
      ) : (
        <>
          <Invites />
          {ended ? <JustEnded missionId={ended} /> : null}
          <CreateMission />
          <OpenMissions />
          <OnlineNow missionId={null} crewIds={new Set()} canInvite={false} />
        </>
      )}
      <PastMissions />
    </div>
  );
}
