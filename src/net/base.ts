/** Keeps this browser's base in step with the one shared base on the crew server, and moves it there. */
import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useApp } from '@/store';
import { DEFAULT_BASE } from '@/planner/base';
import { setBaseMover } from '@/planner/moveBase';
import { auth, convex } from './client';

export function useSharedBase(registered: boolean): void {
  const shared = useQuery(api.base.get, {});
  useEffect(() => {
    if (shared === undefined) return;
    // Nobody has moved it yet: everyone starts from the default spot, whatever this browser kept before.
    const next = shared ?? DEFAULT_BASE;
    const now = useApp.getState().base;
    if (now.lon === next.lon && now.lat === next.lat && now.name === next.name && now.movedAt === (shared?.movedAt ?? undefined)) return;
    useApp.getState().setBase(shared ? { lon: shared.lon, lat: shared.lat, name: shared.name, movedBy: shared.movedByName, movedAt: shared.movedAt } : DEFAULT_BASE);
  }, [shared]);

  useEffect(() => {
    if (!registered || !convex) return;
    const client = convex;
    setBaseMover(async (b) => {
      await client.mutation(api.base.move, { auth: auth(), lon: b.lon, lat: b.lat, name: b.name });
    });
    return () => setBaseMover(null);
  }, [registered]);
}
