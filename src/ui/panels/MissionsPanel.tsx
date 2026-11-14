import { Bot, Car, Caravan, Footprints, Helicopter } from 'lucide-react';
import type { MissionPlan, TaskKind, VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { loadPlaces } from '@/data/datasets';
import { getMap } from '@/map/instance';
import { TASK_DEFAULT_MIN, newId, useApp } from '@/store';
import { fmtDuration } from '@/lib/format';

const ICON = { foot: Footprints, openRover: Car, pressRover: Caravan, robotRover: Bot, heli: Helicopter } as const;

interface Template {
  id: string;
  title: string;
  vehicle: VehicleId;
  /** What the mission is for, in one or two plain sentences. */
  blurb: string;
  /** Place ids from the data, with a fallback position in case the data did not load. */
  start: [id: string, lon: number, lat: number, name: string];
  stops: { place: [id: string, lon: number, lat: number, name: string]; tasks: TaskKind[] }[];
  roundTrip: boolean;
  campAtNight: boolean;
}

const TEMPLATES: readonly Template[] = [
  {
    id: 'delta',
    title: 'Sample run to the delta',
    vehicle: 'foot',
    blurb: 'A walk from the sample depot to the foot of the old river delta, where mud once settled in a lake. Core a sample, photograph the layers, walk home.',
    start: ['three-forks', 77.4062, 18.4489, 'Three Forks'],
    stops: [
      { place: ['wildcat-ridge', 77.4057, 18.4586, 'Wildcat Ridge'], tasks: ['sample', 'photo'] },
      { place: ['jezero-delta-front', 77.4011, 18.4603, 'Jezero delta front'], tasks: ['survey'] },
    ],
    roundTrip: true,
    campAtNight: false,
  },
  {
    id: 'breach',
    title: 'Up the valley to the rim',
    vehicle: 'pressRover',
    blurb: 'Several days in the pressurised rover: across the crater floor, up Neretva Vallis where the river once came in, and out onto the rim. Camp on the way.',
    start: ['octavia-e-butler-landing', 77.4509, 18.4446, 'Octavia E. Butler Landing'],
    stops: [
      { place: ['jezero-delta-front', 77.4011, 18.4603, 'Jezero delta front'], tasks: ['photo'] },
      { place: ['bright-angel', 77.343, 18.497, 'Bright Angel'], tasks: ['sample', 'measure'] },
      { place: ['lookout-hill', 77.285, 18.482, 'Lookout Hill'], tasks: ['survey', 'photo'] },
      { place: ['witch-hazel-hill', 77.262, 18.46, 'Witch Hazel Hill'], tasks: ['sample'] },
    ],
    roundTrip: true,
    campAtNight: true,
  },
  {
    id: 'rim',
    title: 'West rim survey',
    vehicle: 'openRover',
    blurb: 'A quick drive in the open rover along the crater rim, among some of the oldest rocks a crew could reach here. Out and back in suits.',
    start: ['lookout-hill', 77.285, 18.482, 'Lookout Hill'],
    stops: [
      { place: ['witch-hazel-hill', 77.262, 18.46, 'Witch Hazel Hill'], tasks: ['survey'] },
      { place: ['krokodillen', 77.24, 18.44, 'Krokodillen'], tasks: ['sample', 'photo'] },
    ],
    roundTrip: true,
    campAtNight: false,
  },
  {
    id: 'belva',
    title: 'Scout Belva crater by air',
    vehicle: 'heli',
    blurb: 'Send the helicopter ahead to look into Belva crater, a hole punched through the delta that shows its inside in cross-section.',
    start: ['three-forks', 77.4062, 18.4489, 'Three Forks'],
    stops: [{ place: ['belva-crater', 77.385, 18.471, 'Belva crater'], tasks: ['photo'] }],
    roundTrip: true,
    campAtNight: false,
  },
];

async function load(template: Template): Promise<void> {
  const places = await loadPlaces().catch(() => []);
  const find = ([id, lon, lat, name]: Template['start']) => {
    const p = places.find((x) => x.id === id);
    return p ? { lon: p.lon, lat: p.lat, name: p.name, placeId: `place:${p.id}` } : { lon, lat, name };
  };
  const plan: MissionPlan = {
    start: find(template.start),
    stops: template.stops.map((s) => ({
      ...find(s.place),
      id: newId('s'),
      tasks: s.tasks.map((kind) => ({ id: newId('t'), kind, minutes: TASK_DEFAULT_MIN[kind] })),
    })),
    roundTrip: template.roundTrip,
    vehicle: template.vehicle,
    style: 'safest',
    campAtNight: template.campAtNight,
  };
  const app = useApp.getState();
  app.setPlan(plan);
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
        {TEMPLATES.map((t) => {
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
              <p className="mt-2 text-[13px] leading-relaxed">{t.blurb}</p>
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
