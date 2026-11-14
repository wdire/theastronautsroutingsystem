import { loadTraverse } from '@/data/datasets';
import type { MissionPlan } from '@/engines/types';
import { bearingDeg, destination, distanceM } from '@/lib/geo';
import type { PropSpec } from '@/visor';

/** Ingenuity's last landing, after flight 72 on sol 1036 (Valinor Hills Station). From the flight log in public/data. */
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
 * What stands in the 3D scene: Perseverance where it last reported, Ingenuity where it came to rest,
 * and, if a mission has a start, an illustrative base there: a habitat, and the mission's rover.
 */
export async function sceneProps(plan: MissionPlan): Promise<PropSpec[]> {
  const props: PropSpec[] = [{ id: 'ingenuity', model: 'ingenuity', ...INGENUITY_REST, headingDeg: 20 }];
  const rover = await perseverance();
  if (rover) props.push(rover);
  if (plan.start) {
    const { lon: slon, lat: slat } = plan.start;
    const first = plan.stops[0];
    const out = first ? bearingDeg(slon, slat, first.lon, first.lat) : 0;
    // The habitat sits 30 m to the side of the way out, so the first steps of the route are clear.
    const [hlon, hlat] = destination(slon, slat, out + 90, 30);
    props.push({ id: 'habitat', model: 'habitat', lon: hlon, lat: hlat, headingDeg: out - 90 });
    // Two crew by the airlock, the second a step behind.
    const [alon, alat] = destination(slon, slat, out + 95, 9);
    const [blon, blat] = destination(slon, slat, out + 118, 10.5);
    props.push({ id: 'crew-1', model: 'z2', lon: alon, lat: alat, headingDeg: out - 100 }, { id: 'crew-2', model: 'z2', lon: blon, lat: blat, headingDeg: out - 60 });
    if (plan.vehicle === 'pressRover') {
      const [vlon, vlat] = destination(slon, slat, out + 70, 13);
      props.push({ id: 'vehicle', model: 'sev', lon: vlon, lat: vlat, headingDeg: out });
    }
  }
  return props;
}

/**
 * Opening the view on top of something puts the camera inside it. Step back and face it instead.
 */
export function standpoint(lon: number, lat: number, props: readonly PropSpec[]): Standpoint {
  for (const p of props) {
    if (distanceM(lon, lat, p.lon, p.lat) > 6) continue;
    const backM = p.model === 'ingenuity' ? 4 : p.model === 'habitat' ? 18 : 9;
    // From ahead and to one side, so the front and a flank both show.
    const from = p.headingDeg + 35;
    const [vlon, vlat] = destination(p.lon, p.lat, from, backM);
    return { lon: vlon, lat: vlat, headingDeg: bearingDeg(vlon, vlat, p.lon, p.lat) };
  }
  return { lon, lat, headingDeg: 0 };
}

/** What a visitor is told when they stand near something in the scene: what it is and how real it is. */
export function propCaption(id: string): string {
  if (id === 'perseverance') return "Perseverance, standing where it last reported its position. NASA's 3D model of the rover.";
  if (id === 'ingenuity') return "Ingenuity, where it came to rest after its last flight in January 2024. NASA's 3D model.";
  return "An illustrative base at your mission's start, built from NASA's models of a habitat, a pressurised rover and the Z-2 suit. Nothing stands here on Mars.";
}
