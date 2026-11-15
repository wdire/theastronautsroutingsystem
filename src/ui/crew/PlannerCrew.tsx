/**
 * The Crew section of the mission plan: who goes. Solo, the visitor is the crew; a title turns the plan into a
 * crew mission, and from then on the roster (people online, androids, roles, walking order) is shaped here,
 * next to the route it serves. Loaded only with a crew server.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowRight, Users } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import { LIMITS } from '../../../convex/shared';
import { useApp } from '@/store';
import { auth, toastError } from '@/net/client';
import { encodePlan } from '@/net/planSync';
import { useCrew } from '@/net/state';
import { FIELD, Heading, QUIET_BTN, Swatch } from './parts';
import { RosterBlock } from './MissionRoom';
import { OnlineNow } from './Online';

/** Solo by default, in one row; "Bring a crew" opens the one field that turns the plan into a crew mission. */
function CreateCrewMission() {
  const me = useCrew((s) => s.me);
  const create = useMutation(api.missions.create);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 pt-4">
      <Heading>Crew</Heading>
      <div className="flex items-center gap-2.5 rounded-md border py-1 pr-1 pl-3">
        {me ? <Swatch color={me.color} /> : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {me?.name ?? 'You'} <span className="font-normal text-muted-foreground">· commander, solo</span>
        </span>
        {open ? null : (
          <button type="button" className={QUIET_BTN} onClick={() => setOpen(true)}>
            <Users className="size-3.5 text-muted-foreground" aria-hidden />
            Bring a crew
          </button>
        )}
      </div>
      {open ? (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const s = useApp.getState();
            setBusy(true);
            create({
              auth: auth(),
              title,
              objective: '',
              planJson: encodePlan({ plan: s.plan, templateId: s.missionId }),
              vehicle: s.plan.vehicle,
              siteName: s.base.name.slice(0, LIMITS.siteName),
            })
              .then(() => {
                setTitle('');
                setOpen(false);
              })
              .catch(toastError)
              .finally(() => setBusy(false));
          }}
        >
          <div className="flex gap-2">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Mission title" placeholder="Name the mission" maxLength={LIMITS.title} className={FIELD} />
            <button type="submit" className={QUIET_BTN} disabled={busy || !title.trim()}>
              Create
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Then invite people who are online, or add androids.</p>
        </form>
      ) : null}
    </div>
  );
}

function CurrentCrew() {
  const current = useCrew((s) => s.current)!;
  const data = useQuery(api.missions.get, { missionId: current.id, ...auth() });
  const crewIds = useMemo(() => new Set((data?.crew ?? []).filter((c) => c.state !== 'left' && c.personId).map((c) => c.personId as string)), [data?.crew]);
  if (!data) return <p className="px-4 pt-4 text-[13px] text-muted-foreground">Loading the crew…</p>;
  const planning = data.mission.status === 'planning';
  return (
    // The roster and online list draw their own top rules; the planner's own sections sit inside the fieldset.
    <div className="mt-4 [&>section:first-child]:border-t-0">
      <RosterBlock data={data} />
      {data.isCommander && planning ? <OnlineNow missionId={data.mission._id} crewIds={crewIds} canInvite /> : null}
      <div className="px-4 pb-1">
        <button type="button" onClick={() => useApp.getState().openDock('crew')} className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium text-primary transition-colors hover:bg-secondary">
          Departure, tasks and checklist in the crew room
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default function PlannerCrew() {
  const current = useCrew((s) => s.current);
  return current ? <CurrentCrew /> : <CreateCrewMission />;
}
