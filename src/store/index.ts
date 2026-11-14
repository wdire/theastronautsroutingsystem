import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { DonkiFeed } from '@/engines/spaceWeather';
import type { MissionPlan, RouteAlternative, RouteStyle, Scenario, Stop, Task, TaskKind, VehicleId, Waypoint } from '@/engines/types';

export type Mode = 'globe' | 'map';
export type Theme = 'dark' | 'light';
export type DockTab = 'layers' | 'discover' | 'missions' | 'how';

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** Default minutes per task kind (docs/build-spec.md section 4). */
export const TASK_DEFAULT_MIN: Record<TaskKind, number> = { sample: 45, photo: 10, measure: 20, survey: 60, custom: 15 };
export const TASK_NAME: Record<TaskKind, string> = {
  sample: 'Collect a sample',
  photo: 'Take photos',
  measure: 'Take a measurement',
  survey: 'Survey the site',
  custom: 'Task',
};

export const EMPTY_PLAN: MissionPlan = {
  start: null,
  stops: [],
  roundTrip: true,
  vehicle: 'foot',
  style: 'safest',
  campAtNight: false,
};

export const DEFAULT_SCENARIO: Scenario = { dust: 'clear', solarEvent: false, solarCycle: 0.5 };

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export type Overlay = 'none' | 'geology' | 'olivine' | 'carbonate' | 'slope';

export interface LayerState {
  /** Official feature names. */
  names: boolean;
  /** Places Perseverance studied and the samples it took. */
  rover: boolean;
  /** The line of Perseverance’s drive. */
  traverse: boolean;
  /** One coloured overlay at a time. */
  overlay: Overlay;
  /** Light the map as at midday whatever the hour, so the ground is always readable. */
  daylight: boolean;
}

export type RouteState =
  | { status: 'idle' }
  | { status: 'routing'; rev: number; progress: number }
  | { status: 'ready'; rev: number; alternatives: RouteAlternative[]; selected: string; cellM: number; hasBudget: boolean }
  | { status: 'failed'; rev: number; message: string; leg: number; nearest?: readonly [number, number] };

export interface AppState {
  /* view */
  mode: Mode;
  /** True once the first flight into the region has finished; the map chrome appears then, once. */
  landed: boolean;
  /** True while a camera flight between the globe and the region is running. */
  flying: boolean;
  camera: Camera;
  theme: Theme;

  /* clock */
  /** The app’s "now" on Mars, as UTC milliseconds. Never runs backwards while a mission runs. */
  utcMs: number;
  /** True while the app clock follows the real present. */
  clockLive: boolean;
  /** A departure chosen by hand, or null to leave now. */
  departUtcMs: number | null;
  scenario: Scenario;
  /** NASA’s space weather feeds as last fetched; null until they arrive. `spaceWeatherFailed` when nothing answered. */
  spaceWeather: DonkiFeed | null;
  spaceWeatherFailed: boolean;

  /* planner */
  plan: MissionPlan;
  /** Bumped on every change to the plan; routing replies for an older revision are dropped. */
  planRev: number;
  /** The planner panel is showing. */
  plannerOpen: boolean;
  /** What the next click on the map sets, if anything. */
  picking: 'start' | 'stop' | 'roverView' | null;
  route: RouteState;
  /** The spot the 3D ground view is open on, or null while the map shows. */
  visor: { lon: number; lat: number } | null;
  /** The clock stands still (Rover View’s fixed times of day). */
  clockPaused: boolean;

  /* ui */
  dock: DockTab | null;
  layers: LayerState;
  placeId: string | null;
  /** Which detail sections the visitor has opened, by id. Kept for the visit. */
  sections: Record<string, boolean>;

  /* actions */
  setMode(mode: Mode): void;
  setLanded(): void;
  setFlying(flying: boolean): void;
  setCamera(camera: Camera): void;
  setTheme(theme: Theme): void;
  setUtcMs(utcMs: number): void;
  /** Jumps the clock. `live` says whether it should go on following the real present. */
  setClock(utcMs: number, live: boolean): void;
  setDepartUtcMs(utcMs: number | null): void;
  setScenario(patch: Partial<Scenario>): void;
  setSpaceWeather(feed: DonkiFeed | null): void;
  openDock(tab: DockTab | null): void;
  toggleDock(tab: DockTab): void;
  openPlace(id: string | null): void;
  toggleSection(id: string): void;
  setLayers(patch: Partial<LayerState>): void;

  setPlan(plan: MissionPlan): void;
  openPlanner(open: boolean): void;
  setPicking(picking: 'start' | 'stop' | 'roverView' | null): void;
  openVisor(at: { lon: number; lat: number }): void;
  closeVisor(): void;
  setClockPaused(paused: boolean): void;
  setRoute(route: RouteState): void;
  selectRoute(id: string): void;
  setStart(start: Waypoint | null): void;
  addStop(at: Waypoint, index?: number): string;
  removeStop(id: string): void;
  moveStop(id: string, toIndex: number): void;
  updateStop(id: string, patch: Partial<Waypoint>): void;
  addTask(stopId: string, kind: TaskKind, label?: string): void;
  updateTask(stopId: string, taskId: string, patch: Partial<Pick<Task, 'minutes' | 'label' | 'kind'>>): void;
  removeTask(stopId: string, taskId: string): void;
  setVehicle(vehicle: VehicleId): void;
  setStyle(style: RouteStyle): void;
  setRoundTrip(roundTrip: boolean): void;
  setCampAtNight(camp: boolean): void;
  clearPlan(): void;
}

function mapStops(plan: MissionPlan, id: string, fn: (s: Stop) => Stop): MissionPlan {
  return { ...plan, stops: plan.stops.map((s) => (s.id === id ? fn(s) : s)) };
}

export const useApp = create<AppState>()(
  subscribeWithSelector((set, get) => {
    const editPlan = (fn: (plan: MissionPlan) => MissionPlan) =>
      set((s) => ({ plan: fn(s.plan), planRev: s.planRev + 1 }));

    return {
      mode: 'globe',
      landed: false,
      flying: false,
      camera: { lon: 89, lat: 12, zoom: 1.6, bearing: 0, pitch: 0 },
      theme: 'dark',

      utcMs: Date.now(),
      clockLive: true,
      departUtcMs: null,
      scenario: DEFAULT_SCENARIO,
      spaceWeather: null,
      spaceWeatherFailed: false,

      plan: EMPTY_PLAN,
      planRev: 0,
      plannerOpen: false,
      picking: null,
      route: { status: 'idle' },
      visor: null,
      clockPaused: false,

      dock: null,
      layers: { names: true, rover: true, traverse: true, overlay: 'none', daylight: true },
      placeId: null,
      sections: {},

      setMode: (mode) => set({ mode }),
      setLanded: () => set({ landed: true }),
      setFlying: (flying) => set({ flying }),
      setCamera: (camera) => set({ camera }),
      setTheme: (theme) => set({ theme }),
      setUtcMs: (utcMs) => set({ utcMs }),
      setClock: (utcMs, clockLive) => set({ utcMs, clockLive }),
      setDepartUtcMs: (departUtcMs) => set({ departUtcMs }),
      setScenario: (patch) => set((s) => ({ scenario: { ...s.scenario, ...patch } })),
      setSpaceWeather: (feed) => set((s) => (feed ? { spaceWeather: feed, spaceWeatherFailed: false } : { spaceWeatherFailed: s.spaceWeather === null })),
      openDock: (dock) => set({ dock }),
      toggleDock: (tab) => set((s) => ({ dock: s.dock === tab ? null : tab })),
      openPlace: (placeId) => set({ placeId }),
      setLayers: (patch) => set((s) => ({ layers: { ...s.layers, ...patch } })),
      toggleSection: (id) => set((s) => ({ sections: { ...s.sections, [id]: !s.sections[id] } })),

      setPlan: (plan) => editPlan(() => plan),
      openPlanner: (plannerOpen) => set(plannerOpen ? { plannerOpen, placeId: null } : { plannerOpen, picking: null }),
      setPicking: (picking) => set({ picking }),
      openVisor: (visor) => set({ visor, picking: null }),
      closeVisor: () => set({ visor: null }),
      setClockPaused: (clockPaused) => set({ clockPaused }),
      setRoute: (route) => set({ route }),
      selectRoute: (id) => set((s) => (s.route.status === 'ready' ? { route: { ...s.route, selected: id } } : {})),
      setStart: (start) => editPlan((p) => ({ ...p, start })),
      addStop: (at, index) => {
        const id = newId('s');
        editPlan((p) => {
          const stops = p.stops.slice();
          const stop: Stop = { ...at, id, tasks: [] };
          stops.splice(index === undefined ? stops.length : Math.max(0, Math.min(stops.length, index)), 0, stop);
          return { ...p, stops };
        });
        return id;
      },
      removeStop: (id) => editPlan((p) => ({ ...p, stops: p.stops.filter((s) => s.id !== id) })),
      moveStop: (id, toIndex) =>
        editPlan((p) => {
          const from = p.stops.findIndex((s) => s.id === id);
          const stop = p.stops[from];
          if (!stop) return p;
          const stops = p.stops.slice();
          stops.splice(from, 1);
          stops.splice(Math.max(0, Math.min(stops.length, toIndex)), 0, stop);
          return { ...p, stops };
        }),
      updateStop: (id, patch) => editPlan((p) => mapStops(p, id, (s) => ({ ...s, ...patch }))),
      addTask: (stopId, kind, label) =>
        editPlan((p) =>
          mapStops(p, stopId, (s) => ({
            ...s,
            tasks: [...s.tasks, { id: newId('t'), kind, minutes: TASK_DEFAULT_MIN[kind], ...(label ? { label } : {}) }],
          })),
        ),
      updateTask: (stopId, taskId, patch) =>
        editPlan((p) =>
          mapStops(p, stopId, (s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) })),
        ),
      removeTask: (stopId, taskId) =>
        editPlan((p) => mapStops(p, stopId, (s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }))),
      setVehicle: (vehicle) => {
        if (get().plan.vehicle !== vehicle) editPlan((p) => ({ ...p, vehicle }));
      },
      setStyle: (style) => editPlan((p) => ({ ...p, style })),
      setRoundTrip: (roundTrip) => editPlan((p) => ({ ...p, roundTrip })),
      setCampAtNight: (campAtNight) => editPlan((p) => ({ ...p, campAtNight })),
      clearPlan: () => editPlan((p) => ({ ...EMPTY_PLAN, vehicle: p.vehicle })),
    };
  }),
);

declare global {
  interface Window {
    /** The store, for the demo console and the tests. */
    __areo?: typeof useApp;
  }
}

if (typeof window !== 'undefined') window.__areo = useApp;
