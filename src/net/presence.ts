/**
 * Presence: tells the crew server this browser is here, whether it is on the map or in Rover View, and, in
 * Rover View, where the visitor stands. Others' positions come back as walkers for the 3D view to draw.
 */
import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { HEARTBEAT_MS, SUIT_COLOR_HEX } from '../../convex/shared';
import { useApp, type Walker } from '@/store';
import { auth, convex } from './client';

interface Where {
  lon: number;
  lat: number;
  headingDeg: number;
  moving: boolean;
}

const POSITION_MS = 1000;

/** A position worth sending: it moved more than about a metre, turned more than two degrees, or stopped. */
export function whereChanged(a: Where | null, b: Where | null): boolean {
  if (!a || !b) return a !== b;
  return Math.abs(a.lon - b.lon) > 1e-5 || Math.abs(a.lat - b.lat) > 1e-5 || Math.abs(a.headingDeg - b.headingDeg) > 2 || a.moving !== b.moving;
}

/** Runs once at the app root, after the visitor is registered. */
export function usePresence(registered: boolean): void {
  useEffect(() => {
    if (!registered || !convex) return;
    const client = convex;
    let lastBeat = 0;
    let lastView: 'map' | 'rover' | null = null;
    let sentWhere: Where | null = null;
    let seen: { lon: number; lat: number } | null = null;
    let inFlight = false;

    const beat = (force = false) => {
      const s = useApp.getState();
      const view = s.visor ? 'rover' : 'map';
      // Riding along with a mission, the visitor is drawn in the crew's party, not as a walker of their own.
      const riding = s.world?.run != null;
      let where: Where | null = null;
      const v = view === 'rover' && !riding ? window.__areoVisor?.getState() : undefined;
      if (v?.ready) {
        const moved = seen !== null && (Math.abs(v.lon - seen.lon) > 1e-6 || Math.abs(v.lat - seen.lat) > 1e-6);
        seen = { lon: v.lon, lat: v.lat };
        where = { lon: v.lon, lat: v.lat, headingDeg: v.headingDeg, moving: moved };
      } else {
        seen = null;
      }
      const now = Date.now();
      const due = now - lastBeat >= HEARTBEAT_MS || view !== lastView || (where !== null && whereChanged(sentWhere, where));
      if ((!force && !due) || inFlight) return;
      inFlight = true;
      lastBeat = now;
      lastView = view;
      sentWhere = where;
      client
        .mutation(api.people.heartbeat, { ...auth(), view, ...(where ? { where } : {}) })
        .catch(() => {
          // A missed beat is retried on the next tick; the server only marks people away after 40 s.
          lastBeat = 0;
        })
        .finally(() => {
          inFlight = false;
        });
    };

    beat(true);
    const id = window.setInterval(beat, POSITION_MS);
    const onHide = () => void client.mutation(api.people.leave, auth()).catch(() => {});
    const onShow = () => beat(true);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, [registered]);
}

function sameWalkers(a: readonly Walker[], b: readonly Walker[]): boolean {
  return a.length === b.length && a.every((w, i) => {
    const o = b[i];
    return o !== undefined && o.id === w.id && o.lon === w.lon && o.lat === w.lat && o.headingDeg === w.headingDeg && o.moving === w.moving && o.name === w.name && o.color === w.color;
  });
}

/** Everyone else in Rover View, for the 3D view to draw where they stand. */
export function useWalkers(myClientId: string): void {
  const online = useQuery(api.people.online, {});
  useEffect(() => {
    const next: Walker[] = (online ?? [])
      .filter((p) => p.clientId !== myClientId && p.view === 'rover' && p.where)
      .map((p) => ({ id: p.clientId, name: p.name, color: SUIT_COLOR_HEX[p.color], lon: p.where!.lon, lat: p.where!.lat, headingDeg: p.where!.headingDeg, moving: p.where!.moving }));
    if (!sameWalkers(useApp.getState().walkers, next)) useApp.setState({ walkers: next });
  }, [online, myClientId]);
}
