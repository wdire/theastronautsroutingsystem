import { House, TriangleAlert } from 'lucide-react';
import { useApp } from '@/store';
import { cancelBaseMove, confirmBaseMove, useBaseMove } from '@/planner/moveBase';
import { NET_ENABLED } from '@/net/config';
import { fmtDeg, fmtDistance, fmtLatLon } from '@/lib/format';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';

/** Asks before the base moves: it is shared, and every crewed mission starts and ends there. */
export function BaseMoveDialog() {
  const ask = useBaseMove((s) => s.ask);
  const busy = useBaseMove((s) => s.busy);
  const base = useApp((s) => s.base);
  return (
    <Dialog open={ask !== null} onOpenChange={(open) => (open ? undefined : cancelBaseMove())}>
      <DialogContent className="sm:max-w-[26rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <House className="size-[18px] text-primary" aria-hidden />
            Move {base.name} here?
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {NET_ENABLED
              ? 'There is one base, shared by everyone. Every crewed mission, yours and other crews’, will leave from the new spot and come back to it.'
              : 'Every crewed mission will leave from the new spot and come back to it.'}
          </DialogDescription>
        </DialogHeader>
        {ask ? (
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 rounded-md border px-3 py-2.5 text-[13px]">
            <dt className="text-muted-foreground">New spot</dt>
            <dd className="figure">{fmtLatLon(ask.lat, ask.lon)}</dd>
            <dt className="text-muted-foreground">From where it is</dt>
            <dd className="figure">{fmtDistance(ask.fromM)}</dd>
            <dt className="text-muted-foreground">Ground there</dt>
            <dd className="figure">{ask.slopeDeg === null ? 'Not known' : `${fmtDeg(ask.slopeDeg, 1)} slope`}</dd>
          </dl>
        ) : null}
        {ask?.problem ? (
          <p role="alert" className="flex items-start gap-2 text-[13px] leading-relaxed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {ask.problem}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={cancelBaseMove}>
            Keep it where it is
          </Button>
          <Button disabled={!ask || ask.problem !== null || busy} onClick={() => void confirmBaseMove()}>
            {busy ? 'Moving…' : 'Move the base'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
