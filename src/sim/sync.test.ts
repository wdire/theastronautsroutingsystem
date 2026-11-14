import { describe, expect, it } from 'vitest';
import type { PathPoint, TripResult } from '@/engines/types';
import { shapeOnlyTrip } from '@/planner/geometry';
import { createSync, isWorld, parseCommand, SNAPSHOT_INTERVAL_MS } from './sync';
import type { SyncChannel, SyncCommand } from './sync';
import type { World } from './types';
import { createWorld, say, startMission } from './world';

/** A fake BroadcastChannel bus: a message reaches every other open channel, never the sender, after a clone. */
function bus() {
  const channels: (SyncChannel & { open: boolean })[] = [];
  return () => {
    const ch: SyncChannel & { open: boolean } = {
      open: true,
      onmessage: null,
      postMessage(message: unknown) {
        if (!ch.open) throw new Error('closed');
        const data = structuredClone(message);
        for (const other of channels) if (other !== ch && other.open) other.onmessage?.({ data });
      },
      close() {
        ch.open = false;
      },
    };
    channels.push(ch);
    return ch;
  };
}

const PATH: PathPoint[] = [
  [77.4, 18.4, -2500],
  [77.4, 18.41, -2500],
];

function world(): World {
  const trip: TripResult = shapeOnlyTrip(PATH);
  const w = startMission(
    createWorld(Date.UTC(2026, 10, 14, 6)),
    {
      name: 'Test',
      plan: { start: null, stops: [], roundTrip: false, vehicle: 'foot', style: 'safest', campAtNight: false },
      path: PATH,
      stopIndices: [0, 1],
      trip,
    },
    Date.UTC(2026, 10, 14, 6),
  );
  return say(w, 'status');
}

describe('sync', () => {
  it('sends snapshots from the owner to mirrors, at most four a second', () => {
    const open = bus();
    const got: World[] = [];
    const owner = createSync(open(), 'owner', {});
    createSync(open(), 'mirror', { onSnapshot: (w) => got.push(w) });
    const w = world();
    expect(owner.publish(w, 1000)).toBe(true);
    expect(owner.publish(w, 1100)).toBe(false);
    expect(owner.publish(w, 1000 + SNAPSHOT_INTERVAL_MS)).toBe(true);
    expect(owner.publish(w, 1300, true)).toBe(true);
    expect(got).toHaveLength(3);
    expect(got[0]).toEqual(w);
    // Over one second of frames at 60 a second, no more than four go out.
    let sent = 0;
    for (let i = 0; i < 60; i++) if (owner.publish(w, 10_000 + (i * 1000) / 60)) sent++;
    expect(sent).toBeLessThanOrEqual(4);
  });

  it('sends commands from mirrors to the owner', () => {
    const open = bus();
    const cmds: SyncCommand[] = [];
    createSync(open(), 'owner', { onCommand: (c) => cmds.push(c) });
    const mirror = createSync(open(), 'mirror', {});
    expect(mirror.send({ type: 'say', text: 'How is our air?' })).toBe(true);
    expect(mirror.send({ type: 'setSpeed', speed: 20 })).toBe(true);
    expect(mirror.send({ type: 'setPaused', paused: true })).toBe(true);
    expect(mirror.send({ type: 'apply', alertId: 'dust:run1' })).toBe(true);
    expect(mirror.send({ type: 'ignore', alertId: 'o2:reserve' })).toBe(true);
    expect(cmds.map((c) => c.type)).toEqual(['say', 'setSpeed', 'setPaused', 'apply', 'ignore']);
    expect(mirror.publish(world(), 0)).toBe(false);
  });

  it('drops malformed messages from any page', () => {
    const open = bus();
    const snaps: World[] = [];
    const cmds: SyncCommand[] = [];
    createSync(open(), 'owner', { onCommand: (c) => cmds.push(c), onSnapshot: (w) => snaps.push(w) });
    createSync(open(), 'mirror', { onSnapshot: (w) => snaps.push(w), onCommand: (c) => cmds.push(c) });
    const rogue = open();
    const bad: unknown[] = [
      null,
      'hello',
      42,
      [],
      { kind: 'snapshot' },
      { kind: 'snapshot', world: { utcMs: 'soon' } },
      { kind: 'snapshot', world: { ...world(), speed: 7 } },
      { kind: 'snapshot', world: { ...world(), messages: [{ id: 'm1', from: 'mars', text: 'hi', atUtcMs: 0 }] } },
      { kind: 'snapshot', world: { ...world(), run: { ...world().run, path: [[1, 'x', 3]] } } },
      { kind: 'command' },
      { kind: 'command', command: { type: 'setSpeed', speed: 1000 } },
      { kind: 'command', command: { type: 'setPaused', paused: 'yes' } },
      { kind: 'command', command: { type: 'say', text: 'x'.repeat(5000) } },
      { kind: 'command', command: { type: 'say', text: '   ' } },
      { kind: 'command', command: { type: 'apply' } },
      { kind: 'command', command: { type: 'deleteEverything' } },
      { kind: 'nonsense' },
    ];
    for (const m of bad) rogue.postMessage(m);
    expect(snaps).toEqual([]);
    expect(cmds).toEqual([]);
    // A good snapshot reaches only the mirror; a good command reaches only the owner.
    rogue.postMessage({ kind: 'snapshot', world: world() });
    rogue.postMessage({ kind: 'command', command: { type: 'setSpeed', speed: 5, extra: 'dropped' } });
    expect(snaps).toHaveLength(1);
    expect(cmds).toEqual([{ type: 'setSpeed', speed: 5 }]);
  });

  it('answers a new mirror at once, and stops after close', () => {
    const open = bus();
    let hellos = 0;
    const owner = createSync(open(), 'owner', { onHello: () => hellos++ });
    expect(owner.publish(world(), 1000)).toBe(true);
    const got: World[] = [];
    const mirror = createSync(open(), 'mirror', { onSnapshot: (w) => got.push(w) });
    expect(hellos).toBe(1);
    expect(owner.publish(world(), 1010)).toBe(true);
    expect(got).toHaveLength(1);
    mirror.close();
    expect(owner.publish(world(), 5000)).toBe(true);
    expect(got).toHaveLength(1);
    expect(mirror.send({ type: 'setPaused', paused: false })).toBe(false);
  });

  it('checks worlds and commands on their own', () => {
    expect(isWorld(world())).toBe(true);
    expect(isWorld(createWorld(0))).toBe(true);
    expect(isWorld({})).toBe(false);
    expect(parseCommand({ type: 'ignore', alertId: 'a' })).toEqual({ type: 'ignore', alertId: 'a' });
    expect(parseCommand({ type: 'ignore', alertId: '' })).toBeNull();
  });
});
