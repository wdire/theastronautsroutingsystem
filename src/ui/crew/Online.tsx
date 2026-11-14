import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Check } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { auth, toastError } from '@/net/client';
import { Heading, QUIET_BTN, Swatch } from './parts';

/** Who else is here. A commander planning a mission can invite from this list. */
export function OnlineNow({ missionId, crewIds, canInvite }: { missionId: Id<'missions'> | null; crewIds: ReadonlySet<string>; canInvite: boolean }) {
  const people = useQuery(api.people.online, {});
  const missions = useQuery(api.missions.list, {});
  const invite = useMutation(api.crew.invite);
  const myId = auth().clientId;
  const [busy, setBusy] = useState<string | null>(null);
  const titleOf = useMemo(() => new Map((missions ?? []).map((m) => [m._id as string, m.title])), [missions]);
  const others = useMemo(() => (people ?? []).filter((p) => p.clientId !== myId), [people, myId]);

  return (
    <section className="border-t px-4 py-4" aria-labelledby="crew-online">
      <Heading aside={others.length > 0 ? `${others.length}` : undefined}>
        <span id="crew-online">Online now</span>
      </Heading>
      {people === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : others.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No one else is online right now.</p>
      ) : (
        <ul className="flex flex-col">
          {others.map((p) => {
            const onCrew = crewIds.has(p.clientId);
            const badge = p.missionId ? (titleOf.get(p.missionId) ?? 'On a mission') : null;
            return (
              <li key={p.clientId} className="flex items-center gap-2.5 border-t border-border/60 py-2 first:border-t-0">
                <Swatch color={p.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.view === 'rover' ? 'In Rover View' : 'On the map'}
                    {badge ? <span className="text-faint"> · {badge}</span> : null}
                  </span>
                </span>
                {canInvite && missionId && !p.missionId && !onCrew ? (
                  <button
                    type="button"
                    className={QUIET_BTN}
                    disabled={busy === p.clientId}
                    aria-label={`Invite ${p.name}`}
                    onClick={() => {
                      setBusy(p.clientId);
                      invite({ auth: auth(), missionId, personId: p.clientId })
                        .catch(toastError)
                        .finally(() => setBusy(null));
                    }}
                  >
                    Invite
                  </button>
                ) : onCrew ? (
                  <Check className="size-4 text-ok" aria-label="On your crew" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
