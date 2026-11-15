import { loadTraverse } from '@/data/datasets';
import type { MissionPlan } from '@/engines/types';
import { bearingDeg, destination, distanceM } from '@/lib/geo';
import { MODELS, type PropSpec } from '@/visor/modelSpecs';

/** Ingenuity’s last landing, after flight 72 on sol 1036 (Valinor Hills Station). From the flight log in public/data. */
const INGENUITY_REST = { lon: 77.322534, lat: 18.497269 };

/** Where the viewer stands and which way they look when the view opens. */
export interface Standpoint {
  lon: number;
  lat: number;
  headingDeg: number;
}

async function perseverance(): Promise<PropSpec | null> {
  try {
    const { path } = await loadTraverse();
    const last = path.at(-1);
    if (!last) return null;
    // Its heading is the way it last drove: back along the track until the points are a few metres apart.
    let heading = 0;
    for (let i = path.length - 2; i >= 0; i -= 1) {
      const p = path[i];
      if (p && distanceM(p[0], p[1], last[0], last[1]) > 3) {
        heading = bearingDeg(p[0], p[1], last[0], last[1]);
        break;
      }
    }
    return { id: 'perseverance', model: 'perseverance', lon: last[0], lat: last[1], headingDeg: heading };
  } catch {
    return null;
  }
}

/**
 * The base around its airlock door (the point missions leave from): Jezero Station just behind it, its door
 * facing the way out, a NASA habitat module standing apart, the solar array, radio mast and landing pad around
 * it, and the pressurised rover parked by the door. Laid out from the way out, so the first steps of a route are
 * clear of it.
 */
export function baseProps(lon: number, lat: number, outDeg: number): PropSpec[] {
  const at = (bearing: number, m: number) => destination(lon, lat, outDeg + bearing, m);
  // The station's middle 12.5 m behind the door point: its airlock door stands about 3 m behind it.
  const [clon, clat] = at(180, 12.5);
  const [hlon, hlat] = at(-115, 45);
  const [slon, slat] = at(150, 50);
  const [mlon, mlat] = at(-70, 18);
  const [plon, plat] = at(200, 85);
  const [vlon, vlat] = at(60, 13);
  return [
    { id: 'base-station', model: 'station', lon: clon, lat: clat, headingDeg: outDeg },
    { id: 'habitat', model: 'habitat', lon: hlon, lat: hlat, headingDeg: outDeg + 90 },
    { id: 'base-solar', model: 'solar', lon: slon, lat: slat, headingDeg: 0 },
    { id: 'base-mast', model: 'mast', lon: mlon, lat: mlat, headingDeg: outDeg },
    { id: 'base-pad', model: 'pad', lon: plon, lat: plat, headingDeg: 0 },
    { id: 'vehicle', model: 'sev', lon: vlon, lat: vlat, headingDeg: outDeg },
  ];
}

/**
 * What stands in the 3D scene: Perseverance where it last reported, Ingenuity where it came to rest, and the
 * base the plan leaves from (the visitor's own, or the commander's on a crew mission).
 */
export async function sceneProps(plan: MissionPlan, runningVehicle: MissionPlan['vehicle'] | null = null): Promise<PropSpec[]> {
  const props: PropSpec[] = [{ id: 'ingenuity', model: 'ingenuity', ...INGENUITY_REST, headingDeg: 20 }];
  const rover = await perseverance();
  if (rover) props.push(rover);
  if (plan.start) {
    const first = plan.stops[0];
    const out = first ? bearingDeg(plan.start.lon, plan.start.lat, first.lon, first.lat) : 0;
    // The pressurised rover is out with the crew while a mission drives it, and is drawn with them instead.
    props.push(...baseProps(plan.start.lon, plan.start.lat, out).filter((p) => !(p.id === 'vehicle' && runningVehicle === 'pressRover')));
  }
  return props;
}

/**
 * Opening the view on top of something puts the camera inside it. Step back and face it instead.
 */
export function standpoint(lon: number, lat: number, props: readonly PropSpec[]): Standpoint {
  for (const p of props) {
    const { clearM } = MODELS[p.model];
    if (distanceM(lon, lat, p.lon, p.lat) > clearM + 3) continue;
    // Far enough back to take the whole of it in, from ahead and to one side so the front and a flank both show.
    const [vlon, vlat] = destination(p.lon, p.lat, p.headingDeg + 35, clearM * 2.2 + 2);
    return { lon: vlon, lat: vlat, headingDeg: bearingDeg(vlon, vlat, p.lon, p.lat) };
  }
  return { lon, lat, headingDeg: 0 };
}

/** What a visitor is told when they stand near something in the scene: what it is and how real it is. */
export function propCaption(id: string): string {
  if (id === 'perseverance') return "Perseverance, standing where it last reported its position. NASA’s 3D model of the rover.";
  if (id === 'ingenuity') return "Ingenuity, where it came to rest after its last flight in January 2024. NASA’s 3D model.";
  return "Your base, illustrative: a drawn station (a domed hub, two laboratories and a greenhouse, joined by tunnels), NASA’s models of a habitat module and a pressurised rover, a solar array, radio mast and landing pad. Nothing stands here on Mars yet.";
}
