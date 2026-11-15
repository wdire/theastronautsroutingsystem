/**
 * The Crew panel: who the visitor is to others, invites, the mission they are in (or the ones they could join,
 * or start), who else is online, and the debriefs of missions flown. Loaded only with a crew server.
 */
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowRight, FileText, Pencil, Route } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { LIMITS, SUIT_COLORS, type SuitColor } from '../../../convex/shared';
import { useApp } from '@/store';
import { auth, toastError } from '@/net/client';
import { cleanName, loadIdentity, saveIdentity } from '@/net/identity';
import { useCrew } from '@/net/state';
import { OnlineNow } from './Online';
import { fmtUtc } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FIELD, Heading, PRIMARY_BTN, QUIET_BTN, StatusChip, Swatch } from './parts';
import { MissionRoom } from './MissionRoom';
import JoinList from './JoinList';

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

/** Flying solo: the mission is real, it just has no shared crew. Say so, and where to watch it. */
function SoloRun() {
  const name = useApp((s) => s.world?.run?.name ?? 'Mission');
  const status = useApp((s) => s.world?.run?.status);
  return (
    <section className="border-t px-4 py-4">
      <p className="text-[13.5px] font-semibold">{status === 'running' ? `${name}, flown solo` : `${name} is over`}</p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
        Your crew, supplies, stops and alerts are in the mission panel on the left. To fly with other people or androids, name your next plan to make it a crew mission.
      </p>
    </section>
  );
}

/** Off any mission: say so, and point to where missions are made. */
function NoMission() {
  const plan = () => {
    const s = useApp.getState();
    s.openDock(null);
    s.openPlanner(true);
  };
  return (
    <section className="border-t px-4 py-4">
      <p className="text-[13.5px] font-semibold">You are not on a mission</p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">Plan one from your base and name it to bring a crew, or join one below. Your crew, roles, tasks and notes show here once you are on one.</p>
      <button type="button" className={cn(QUIET_BTN, 'mt-2.5')} onClick={plan}>
        <Route className="size-3.5 text-muted-foreground" aria-hidden />
        Plan a mission
      </button>
    </section>
  );
}

export default function CrewPanel() {
  const me = useCrew((s) => s.me);
  const current = useCrew((s) => s.current);
  const ended = useCrew((s) => s.ended);
  const soloRun = useApp((s) => s.world?.run != null);
  if (!me) return <p className="px-4 py-4 text-[13px] text-muted-foreground">Connecting to the crew server…</p>;
  return (
    <div className="pb-2">
      <You />
      {current ? (
        <MissionRoom missionId={current.id} />
      ) : (
        <>
          {ended ? <JustEnded missionId={ended} /> : null}
          {soloRun ? <SoloRun /> : <NoMission />}
          <JoinList limit={5} />
          <OnlineNow missionId={null} crewIds={new Set()} canInvite={false} />
        </>
      )}
      <PastMissions />
    </div>
  );
}
