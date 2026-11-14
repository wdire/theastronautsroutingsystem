/**
 * Invites and the missions open to join, short: a few, then "Show more". Shown on the left (where missions are
 * made and found) and in the Crew tab when the visitor is on no mission. Loaded only with a crew server.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ChevronDown } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { MAX_CREW } from '../../../convex/shared';
import { useApp } from '@/store';
import { auth, toastError } from '@/net/client';
import { useCrew } from '@/net/state';
import { cn } from '@/lib/cn';
import { fmtFromNow, fmtMarsMoment, vehicleName } from './format';
import { Heading, PRIMARY_BTN, QUIET_BTN, StatusChip } from './parts';
import { useNow } from './useNow';

/** After joining, the visitor sees the plan they joined and the crew room beside it. */
function afterJoin(): void {
  const s = useApp.getState();
  s.openPlanner(true);
  s.openDock('crew');
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
      .then(() => (accept ? afterJoin() : undefined))
      .catch(toastError)
      .finally(() => setBusy(null));
  };
  return (
    <ul className="flex flex-col gap-2" aria-label="Invites">
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
  );
}

/** The missions being planned or flown that the visitor could join. */
export default function JoinList({ limit = 3, framed = true }: { limit?: number; framed?: boolean }) {
  const missions = useQuery(api.missions.list, {});
  const join = useMutation(api.crew.join);
  const current = useCrew((s) => s.current);
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const lon = useApp((s) => s.base.lon);
  const open = useMemo(() => (missions ?? []).filter((m) => m.status === 'planning' || m.status === 'underway'), [missions]);
  // On a mission already: there is nothing to join until it ends.
  if (current) return null;
  const shown = all ? open : open.slice(0, limit);
  const hidden = open.length - shown.length;

  return (
    <section className={cn(framed && 'border-t px-4 py-4')} aria-labelledby="join-heading">
      <Invites />
      <div className="mt-3 first:mt-0">
        <Heading aside={open.length > 0 ? `${open.length}` : undefined}>
          <span id="join-heading">Missions you can join</span>
        </Heading>
      </div>
      {missions === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : open.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">Nobody is planning a mission right now. Plan one and invite whoever is online.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((m) => (
            <li key={m._id} className="rounded-md border px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[13.5px] font-semibold">{m.title}</p>
                <StatusChip status={m.status} />
              </div>
              <p className="figure mt-0.5 truncate text-xs text-muted-foreground">
                {m.commanderName} · {m.crewCount} of {MAX_CREW} crew · {vehicleName(m.vehicle)}
              </p>
              {m.plannedStartUtc !== null ? (
                <p className="figure truncate text-xs text-muted-foreground">
                  Departs {fmtMarsMoment(m.plannedStartUtc, lon)}, {fmtFromNow(m.plannedStartUtc, now)}
                </p>
              ) : null}
              {m.open ? (
                <button
                  type="button"
                  className={cn(QUIET_BTN, 'mt-2')}
                  disabled={busy === m._id}
                  onClick={() => {
                    setBusy(m._id);
                    join({ auth: auth(), missionId: m._id })
                      .then(afterJoin)
                      .catch(toastError)
                      .finally(() => setBusy(null));
                  }}
                >
                  Join
                </button>
              ) : (
                <p className="mt-1.5 text-xs text-faint">Closed to new crew. The commander can invite you.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 || all ? (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          {all ? 'Show fewer' : `Show ${hidden} more`}
          <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
