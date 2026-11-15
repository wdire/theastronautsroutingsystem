/**
 * The crew layer, loaded after the first paint only when a crew server is configured. It wraps the map chrome
 * in the Convex provider and runs, once, everything that keeps this browser and the server in step.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ConvexProvider } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { auth, convex, toastError } from './client';
import { loadIdentity } from './identity';
import { useCrewLog, useCurrentMission, usePlanSync } from './mission';
import { usePresence, useWalkers } from './presence';
import { startCrewMission, useCommanderRun, useMemberRun } from './runSync';
import { useCrew } from './state';
import { useSharedBase } from './base';

function useRegister(): boolean {
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    if (!convex) return;
    let cancelled = false;
    const id = loadIdentity();
    convex
      .mutation(api.people.register, { clientId: id.clientId, secret: id.secret, name: id.name, color: id.color })
      .then((p) => {
        if (cancelled) return;
        useCrew.setState({ me: { clientId: p.clientId, name: p.name, color: p.color } });
        setRegistered(true);
      })
      .catch(toastError);
    return () => {
      cancelled = true;
    };
  }, []);
  return registered;
}

function NetEffects() {
  const registered = useRegister();
  usePresence(registered);
  useSharedBase(registered);
  useWalkers(auth().clientId);
  const data = useCurrentMission(registered);
  const current = useCrew((s) => s.current);
  const ended = useCrew((s) => s.ended);
  useCrewLog(current?.id ?? ended, current !== null && current.status === 'underway');
  usePlanSync(data);
  useCommanderRun(data);
  useMemberRun(data);

  // Start belongs to the commander of a mission being planned.
  const startable = current !== null && current.isCommander && current.status === 'planning' ? current.id : null;
  useEffect(() => {
    useCrew.setState({ start: startable ? () => startCrewMission(startable) : null });
    return () => useCrew.setState({ start: null });
  }, [startable]);
  return null;
}

export default function NetRoot({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return (
    <ConvexProvider client={convex}>
      <NetEffects />
      {children}
    </ConvexProvider>
  );
}
