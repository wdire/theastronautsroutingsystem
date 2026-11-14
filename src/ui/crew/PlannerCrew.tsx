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

function CreateCrewMission() {
  const me = useCrew((s) => s.me);
  const create = useMutation(api.missions.create);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="px-4 pt-4">
      <Heading>Crew</Heading>
      {me ? (
        <div className="flex items-center gap-2.5 rounded-md border px-3 py-2">
          <Swatch color={me.color} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{me.name}</span>
          <span className="text-xs text-muted-foreground">Commander</span>
        </div>
      ) : null}
      <form
        className="mt-2 flex flex-col items-start gap-2"
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
            .then(() => setTitle(''))
            .catch(toastError)
            .finally(() => setBusy(false));
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Mission title" placeholder="Mission name, to bring a crew" maxLength={LIMITS.title} className={FIELD} />
        <button type="submit" className={QUIET_BTN} disabled={busy || !title.trim()}>
          <Users className="size-3.5 text-muted-foreground" aria-hidden />
          Make it a crew mission
        </button>
      </form>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">Then invite people who are online, or add androids. Alone, you fly it solo.</p>
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
