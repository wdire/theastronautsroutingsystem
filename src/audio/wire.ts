/**
 * Where the cues are heard: the app's state is watched here, not in the components, so a flight, an alert or a
 * mission sounds the same whichever button, shortcut or crew snapshot caused it.
 */
import type { Severity } from '@/engines/types';
import { prefersReducedMotion } from '@/map/camera';
import { useApp } from '@/store';
import { armAudio } from './engine';
import * as cue from './cues';

/** The flights' lengths, s, as camera.ts flies them. */
const DESCENT_S = 7.2;
const ASCENT_S = 5.2;
/** Alerts that arrive together are heard as one: the worst of them. */
const ALERT_GAP_MS = 1200;

const RANK: Record<Severity, number> = { note: 0, advisory: 1, caution: 2, warning: 3 };

export function startSoundCues(): () => void {
  armAudio();
  const stops: (() => void)[] = [];

  // The flights. flyIn marks the flight before the mode changes, flyOut after: the mode tells them apart.
  let flight: cue.Playing | null = null;
  let flightDown = false;
  stops.push(
    useApp.subscribe(
      (s) => s.flying,
      (flying) => {
        const s = useApp.getState();
        if (flying) {
          flight?.stop();
          flightDown = s.mode === 'globe';
          flight = prefersReducedMotion() ? null : flightDown ? cue.descent(DESCENT_S) : cue.ascent(ASCENT_S);
          return;
        }
        if (flightDown && s.mode === 'map') cue.touchdown();
        else flight?.stop();
        flight = null;
      },
    ),
  );

  stops.push(
    useApp.subscribe(
      (s) => s.visor !== null,
      (open) => (open ? cue.helmetOn() : cue.helmetOff()),
    ),
  );

  // A stop dropped on the map. A whole plan loaded at once is not a tick.
  stops.push(
    useApp.subscribe(
      (s) => s.plan.stops.length,
      (n, was) => {
        if (n === was + 1) cue.tick();
      },
    ),
  );

  // Missions: one cue when one gets under way and one when it ends.
  stops.push(
    useApp.subscribe(
      (s) => (s.world?.run ? `${s.world.run.id}:${s.world.run.status}` : null),
      (now, was) => {
        if (!now) return;
        const [id, status] = now.split(':');
        const [wasId, wasStatus] = was ? was.split(':') : [];
        if (status === 'running' && (id !== wasId || wasStatus !== 'running')) cue.missionStart();
        else if (id === wasId && wasStatus === 'running' && status !== 'running') cue.missionEnd(status === 'done');
      },
    ),
  );

  // Alerts: each heard once, as it arrives, by how much it matters; an answer gets a small "done".
  let runId: string | null = null;
  let heard = new Set<string>();
  let answered = new Set<string>();
  let lastAlertAt = 0;
  stops.push(
    useApp.subscribe(
      (s) => s.world?.alerts,
      (alerts) => {
        const run = useApp.getState().world?.run?.id ?? null;
        if (!alerts) return;
        if (run !== runId) {
          // A new mission, or one picked up part way: what was already there is not news.
          runId = run;
          heard = new Set(alerts.map((a) => a.id));
          answered = new Set(alerts.filter((a) => a.resolved).map((a) => a.id));
          return;
        }
        let worst: Severity | null = null;
        for (const a of alerts) {
          if (!heard.has(a.id)) {
            heard.add(a.id);
            if (!a.resolved && (worst === null || RANK[a.severity] > RANK[worst])) worst = a.severity;
          }
        }
        let acked = false;
        for (const a of alerts) {
          if (a.resolved && !answered.has(a.id)) {
            answered.add(a.id);
            if (a.resolved !== 'expired') acked = true;
          }
        }
        const now = performance.now();
        if (worst && worst !== 'note' && now - lastAlertAt > ALERT_GAP_MS) {
          lastAlertAt = now;
          if (worst === 'warning') cue.warning();
          else if (worst === 'caution') cue.caution();
          else cue.advisory();
        } else if (acked) cue.acknowledge();
      },
    ),
  );

  return () => {
    stops.forEach((s) => s());
    flight?.stop();
  };
}
