import { describe, expect, it } from 'vitest';
import { tick } from '@/sim/world';
import { encodeRoute, encodeSnapshot, parseRoute, parseSnapshot, plannedFrom, rebuildWorld, routeOf } from './snapshot';
import { startedWorld } from './testing/world';

describe('live snapshot and route', () => {
  it('splits a world in two and puts it back together', () => {
    const w = tick(startedWorld(), 600);
    const run = w.run!;
    const planned = plannedFrom(run.trip, run.startedUtcMs, run.startLevels);
    const snapJson = encodeSnapshot(w, planned);
    const routeJson = encodeRoute(routeOf(run));
    // The snapshot carries no path or trip; the route carries them.
    expect(snapJson).not.toContain('"path"');
    expect(snapJson).not.toContain('"samples"');
    const snap = parseSnapshot(snapJson)!;
    const route = parseRoute(routeJson)!;
    expect(snap.planned!.durationS).toBeCloseTo(planned.durationS, 4);
    expect(snap.planned!.o2EndFrac!).toBeCloseTo(planned.o2EndFrac!, 5);
    const back = rebuildWorld(snap, route)!;
    expect(back).not.toBeNull();
    expect(back.run!.path).toHaveLength(run.path.length);
    expect(back.run!.trip.samples).toHaveLength(run.trip.samples.length);
    expect(back.run!.tasks).toEqual(run.tasks);
    expect(back.utcMs).toBeCloseTo(w.utcMs, 0);
    expect(back.run!.path[5]![1]).toBeCloseTo(run.path[5]![1], 6);
    expect(back.run!.trip.samples[7]!.o2Kg!).toBeCloseTo(run.trip.samples[7]!.o2Kg!, 5);
  });

  it('keeps the route small: columns, not repeated keys', () => {
    const run = startedWorld().run!;
    const plain = JSON.stringify(run.trip.samples);
    const packed = encodeRoute(routeOf(run));
    expect(packed.length).toBeLessThan(plain.length * 0.75);
  });

  it('waits for the route of the snapshot\'s own leg', () => {
    const w = startedWorld();
    const snap = parseSnapshot(encodeSnapshot(w, null))!;
    const route = parseRoute(encodeRoute({ ...routeOf(w.run!), leg: 3 }))!;
    expect(rebuildWorld(snap, route)).toBeNull();
    expect(rebuildWorld(snap, null)).toBeNull();
  });

  it('drops anything malformed', () => {
    const w = startedWorld();
    const run = w.run!;
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 2, leg: 0, world: {} }))).toBeNull();
    expect(parseRoute('[]')).toBeNull();
    // A route whose sample columns were renamed or cut short.
    const good = JSON.parse(encodeRoute(routeOf(run)));
    expect(parseRoute(JSON.stringify({ ...good, trip: { ...good.trip, samples: { keys: ['x'], rows: [] } } }))).toBeNull();
    expect(parseRoute(JSON.stringify({ ...good, trip: { ...good.trip, samples: { ...good.trip.samples, rows: [[1, 2]] } } }))).toBeNull();
    // A snapshot whose world is broken inside passes the envelope check but not the rebuild.
    const snap = JSON.parse(encodeSnapshot(w, null));
    snap.world.alerts = [{ id: 1 }];
    expect(rebuildWorld(parseSnapshot(JSON.stringify(snap))!, parseRoute(encodeRoute(routeOf(run))))).toBeNull();
    // Path and samples that do not line up.
    const short = { ...good, path: good.path.slice(0, 3) };
    expect(rebuildWorld(parseSnapshot(encodeSnapshot(w, null))!, parseRoute(JSON.stringify(short)))).toBeNull();
  });

  it('says what the route promised at the end', () => {
    const run = startedWorld().run!;
    const p = plannedFrom(run.trip, run.startedUtcMs, run.startLevels);
    expect(p.durationS).toBe(run.trip.totals.durationS);
    expect(p.o2EndFrac).toBeGreaterThan(0);
    expect(p.o2EndFrac).toBeLessThan(1);
    expect(p.batteryEndFrac).toBeNull();
  });
});
