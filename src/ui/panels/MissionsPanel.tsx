import { Bot, Car, Caravan, Footprints, Helicopter } from 'lucide-react';
import { MISSIONS, toPlan, type Mission } from '@/engines/missions';
import { VEHICLES } from '@/engines/vehicles';
import { getMap } from '@/map/instance';
import { TASK_DEFAULT_MIN, useApp } from '@/store';
import { fmtDuration } from '@/lib/format';

const ICON = { foot: Footprints, openRover: Car, pressRover: Caravan, robotRover: Bot, heli: Helicopter } as const;

async function load(mission: Mission): Promise<void> {
  const plan = toPlan(mission);
  const app = useApp.getState();
  app.setPlan(plan, mission.id);
  app.openPlanner(true);
  // Frame the whole mission.
  const lons = [plan.start?.lon ?? 0, ...plan.stops.map((s) => s.lon)];
  const lats = [plan.start?.lat ?? 0, ...plan.stops.map((s) => s.lat)];
  getMap()?.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: { left: 440, right: 140, top: 110, bottom: 110 }, maxZoom: 14.5, duration: 1800 },
  );
}

/** Ready-made missions. Each loads into the planner, where every stop and task can be changed. */
export function MissionsPanel() {
  return (
    <div className="px-4 pt-3 pb-4">
      <p className="text-[13px] leading-relaxed text-muted-foreground">Four missions to start from. Each one opens in the mission plan, where you can change anything.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {MISSIONS.map((t) => {
          const Icon = ICON[t.vehicle];
          const tasks = t.stops.reduce((n, s) => n + s.tasks.length, 0);
          const work = t.stops.reduce((n, s) => n + s.tasks.reduce((m, k) => m + TASK_DEFAULT_MIN[k], 0), 0);
          return (
            <li key={t.id} className="rounded-md border p-3">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <h3 className="text-[13.5px] font-semibold">{t.title}</h3>
                  <p className="figure mt-0.5 text-xs text-muted-foreground">
                    {VEHICLES[t.vehicle].name}, {t.stops.length} {t.stops.length === 1 ? 'stop' : 'stops'}, {tasks} {tasks === 1 ? 'task' : 'tasks'}, {fmtDuration(work * 60)} of work
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed">{t.brief}</p>
              <button
                type="button"
                onClick={() => void load(t)}
                className="mt-3 inline-flex h-8 items-center rounded-md bg-secondary px-3 text-[13px] font-semibold transition-colors hover:bg-accent"
              >
                Open in the mission plan
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
