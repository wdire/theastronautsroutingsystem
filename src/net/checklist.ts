/**
 * The pre-EVA checklist each crew member works through before the mission sets out. The items follow NASA EVA
 * practice: a suit leak check, prebreathe, glove inspection, a buddy check of the suit, a comm check with the
 * habitat, consumables against the plan, and a brief of the route and the turn-back point. Which ones apply
 * depends on the vehicle: a pressurised cabin replaces the suit checks, a robot needs a command link instead.
 */
import type { TripTotals, Vehicle } from '@/engines/types';
import { fmtNumber, fmtPercent } from '@/lib/format';

export interface CheckItem {
  id: string;
  text: string;
  detail: string;
}


function reserves(t: TripTotals | null): string {
  if (!t) return 'Work out the route first; the planner then gives what the trip uses.';
  const parts: string[] = [];
  if (t.minO2Frac !== null) parts.push(`at least ${fmtPercent(t.minO2Frac)} of the oxygen`);
  if (t.minBatteryFrac !== null) parts.push(`at least ${fmtPercent(t.minBatteryFrac)} of the battery`);
  return parts.length ? `The plan uses ${fmtNumber(t.o2Kg, 2)} kg of oxygen and ${fmtNumber(t.energyKWh, 1)} kWh, and keeps ${parts.join(' and ')}.` : `The plan uses ${fmtNumber(t.energyKWh, 2)} kWh.`;
}

export function preEvaChecklist(vehicle: Vehicle, totals: TripTotals | null): CheckItem[] {
  const route: CheckItem = { id: 'route-brief', text: 'Route brief', detail: 'Go over the stops, the hazards on the way, the point of no return and how to turn back.' };
  const consumables: CheckItem = { id: 'consumables', text: 'Consumables against the plan', detail: reserves(totals) };

  if (vehicle.crew === 0) {
    return [
      { id: 'link-check', text: 'Command link check', detail: `Confirm the habitat can command the ${vehicle.name.toLowerCase()} and receive its telemetry.` },
      { id: 'plan-review', text: vehicle.kind === 'air' ? 'Flight plan review' : 'Drive plan review', detail: 'Check every leg, its slopes and the stops against the map before it is sent.' },
      consumables,
      route,
    ];
  }

  if (vehicle.cabin) {
    return [
      { id: 'cabin-check', text: 'Cabin pressure and life support check', detail: 'Cabin holds pressure, CO2 removal running, oxygen supply and temperature in range.' },
      { id: 'contingency-suits', text: 'Suits ready for a contingency walk', detail: 'Suits checked at the suitports, so the crew can leave the cabin if it has to be abandoned.' },
      { id: 'comm-check', text: 'Comm check with the habitat', detail: 'Every crew member heard on the loop, and every crew member hears the habitat.' },
      consumables,
      route,
    ];
  }

  return [
    { id: 'leak-check', text: 'Suit leak check', detail: 'Pressurise the suit and watch the pressure hold for the length of the test.' },
    { id: 'prebreathe', text: 'Prebreathe', detail: 'Breathe pure oxygen for the set time, so nitrogen leaves the blood before going to suit pressure.' },
    { id: 'gloves', text: 'Glove and visor inspection', detail: 'Look for cuts or wear on the palms and fingertips, and scratches on the visor.' },
    { id: 'buddy-check', text: 'Buddy check', detail: 'A crewmate checks your connectors, straps, display and controls, and you check theirs.' },
    { id: 'comm-check', text: 'Comm check with the habitat', detail: 'Every crew member heard on the loop, and every crew member hears the habitat.' },
    ...(vehicle.batteryKWh > 0 ? [{ id: 'rover-check', text: 'Rover systems check', detail: 'Battery charge, steering and brakes checked before the crew climbs on.' }] : []),
    consumables,
    route,
  ];
}
