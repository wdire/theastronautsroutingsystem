/**
 * Turns the routes found for each style into the cards the route card shows.
 *
 * Styles that came out the same share one card ("Safest, fastest and eco agree"). An eco route that
 * saves nothing is not shown as a choice: it folds into the route that beats it. Badges are given
 * only for a real saving, and equal times are tagged as equal rather than ranked.
 */
import type { LonLat, PathPoint, RouteAlternative, RouteCandidate, RouteStyle } from '../types';

/** Two paths are the same if they lie this close together on average, metres. */
export const SAME_PATH_M = 150;
/** Two numbers are the same if they differ by no more than this share; a saving must beat it. */
export const SAME_SHARE = 0.03;

const STYLE_ORDER: readonly RouteStyle[] = ['safest', 'fastest', 'eco'];
const STYLE_NAME: Record<RouteStyle, string> = { safest: 'safest', fastest: 'fastest', eco: 'eco' };
const DEG = Math.PI / 180;
const M_PER_DEG = (Math.PI / 180) * 3_396_190;

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "Safest", "Safest and fastest agree", "Safest, fastest and eco agree". */
export function labelFor(styles: readonly RouteStyle[]): string {
  const names = styles.map((s) => STYLE_NAME[s]);
  const first = names[0];
  if (first === undefined) return '';
  if (names.length === 1) return capital(first);
  const head = names.slice(0, -1).join(', ');
  return `${capital(head)} and ${names[names.length - 1]} agree`;
}

function same(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= SAME_SHARE * Math.max(Math.abs(a), Math.abs(b));
}

/** True if a is lower than b by more than 3%. */
function saves(a: number, b: number): boolean {
  return a < b * (1 - SAME_SHARE);
}

/* ---------- path separation ---------- */

/** Mean distance from points spread along `a` to the line of `b`, metres. */
function meanDistanceTo(a: readonly PathPoint[], b: readonly PathPoint[]): number {
  const origin = a[0] ?? b[0];
  if (!origin || a.length === 0 || b.length === 0) return Infinity;
  const kx = Math.cos(origin[1] * DEG) * M_PER_DEG;
  const x = (p: LonLat | PathPoint): number => (p[0] - origin[0]) * kx;
  const y = (p: LonLat | PathPoint): number => (p[1] - origin[1]) * M_PER_DEG;

  // About 200 points evenly spread along a.
  const lengths: number[] = [0];
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1] as PathPoint;
    const q = a[i] as PathPoint;
    lengths.push((lengths[i - 1] as number) + Math.hypot(x(q) - x(p), y(q) - y(p)));
  }
  const total = lengths[lengths.length - 1] as number;
  const samples = Math.max(2, Math.min(200, Math.ceil(total / 25) + 1));
  let seg = 1;
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    const d = (total * k) / (samples - 1);
    while (seg < a.length - 1 && (lengths[seg] as number) < d) seg++;
    const p = a[seg - 1] as PathPoint;
    const q = a[seg] ?? p;
    const span = (lengths[seg] ?? 0) - (lengths[seg - 1] as number);
    const t = span > 0 ? (d - (lengths[seg - 1] as number)) / span : 0;
    const px = x(p) + (x(q) - x(p)) * t;
    const py = y(p) + (y(q) - y(p)) * t;

    let best = Infinity;
    if (b.length === 1) best = Math.hypot(px - x(b[0] as PathPoint), py - y(b[0] as PathPoint)) ** 2;
    for (let i = 1; i < b.length; i++) {
      const ax = x(b[i - 1] as PathPoint);
      const ay = y(b[i - 1] as PathPoint);
      const dx = x(b[i] as PathPoint) - ax;
      const dy = y(b[i] as PathPoint) - ay;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d2 = (px - ax - dx * u) ** 2 + (py - ay - dy * u) ** 2;
      if (d2 < best) best = d2;
    }
    sum += Math.sqrt(best);
  }
  return sum / samples;
}

/** How far apart two paths lie on average, metres: the larger of the two one-way means. */
export function meanSeparationM(a: readonly PathPoint[], b: readonly PathPoint[]): number {
  return Math.max(meanDistanceTo(a, b), meanDistanceTo(b, a));
}

/* ---------- merging ---------- */

interface Group {
  styles: RouteStyle[];
  lead: RouteCandidate;
}

function agree(a: RouteCandidate, b: RouteCandidate): boolean {
  const ta = a.trip.totals;
  const tb = b.trip.totals;
  return (
    same(ta.durationS, tb.durationS) &&
    same(ta.energyKWh, tb.energyKWh) &&
    same(ta.o2Kg, tb.o2Kg) &&
    meanSeparationM(a.path, b.path) < SAME_PATH_M
  );
}

/**
 * Merge the routed styles into cards.
 * - The same path (mean separation under 150 m) with time, energy and O2 within 3% is one card that
 *   lists every style, e.g. "Safest and fastest agree".
 * - An eco route that saves no oxygen and no power against another card folds into the card that
 *   beats it.
 * - "Quickest", "Least O2" and "Least power" go only to a card that beats every other by more than
 *   3%. Cards whose times are within 3% of each other say "Same time as ..." instead.
 * Cards come back in the order safest, fastest, eco.
 */
export function mergeAlternatives(candidates: RouteCandidate[]): RouteAlternative[] {
  const byStyle = new Map<RouteStyle, RouteCandidate>();
  for (const c of candidates) if (!byStyle.has(c.style)) byStyle.set(c.style, c);

  const groups: Group[] = [];
  for (const style of STYLE_ORDER) {
    const c = byStyle.get(style);
    if (!c) continue;
    const home = groups.find((group) => agree(group.lead, c));
    if (home) home.styles.push(style);
    else groups.push({ styles: [style], lead: c });
  }

  // An eco route on its own that saves nothing folds into the card that beats it.
  const ecoAt = groups.findIndex((group) => group.styles.length === 1 && group.styles[0] === 'eco');
  if (ecoAt >= 0 && groups.length > 1) {
    const eco = (groups[ecoAt] as Group).lead.trip.totals;
    const usesO2 = groups.some((group) => group.lead.trip.totals.o2Kg > 0);
    const measure = (group: Group): number =>
      usesO2 ? group.lead.trip.totals.o2Kg : group.lead.trip.totals.energyKWh;
    let winner: Group | null = null;
    for (const group of groups) {
      if (group.styles.includes('eco')) continue;
      const t = group.lead.trip.totals;
      if (saves(eco.o2Kg, t.o2Kg) || saves(eco.energyKWh, t.energyKWh)) continue;
      if (
        !winner ||
        measure(group) < measure(winner) ||
        (measure(group) === measure(winner) && t.durationS < winner.lead.trip.totals.durationS)
      ) {
        winner = group;
      }
    }
    if (winner) {
      winner.styles.push('eco');
      groups.splice(ecoAt, 1);
    }
  }

  const cards: RouteAlternative[] = groups.map((group) => ({
    id: group.styles.join('+'),
    styles: group.styles,
    label: labelFor(group.styles),
    badges: [],
    path: group.lead.path,
    stopIndices: group.lead.stopIndices,
    trip: group.lead.trip,
  }));
  if (cards.length < 2) return cards;

  const beatsAll = (card: RouteAlternative, value: (c: RouteAlternative) => number): boolean =>
    cards.every((other) => other === card || saves(value(card), value(other)));
  const time = (c: RouteAlternative): number => c.trip.totals.durationS;
  const o2 = (c: RouteAlternative): number => c.trip.totals.o2Kg;
  const power = (c: RouteAlternative): number => c.trip.totals.energyKWh;
  const anyO2 = cards.some((c) => o2(c) > 0);
  const anyPower = cards.some((c) => power(c) > 0);

  for (const card of cards) {
    if (beatsAll(card, time)) {
      card.badges.push('Quickest');
    } else {
      const twin = cards.find((other) => other !== card && same(time(other), time(card)));
      const name = twin?.styles[0];
      if (name) card.badges.push(`Same time as ${capital(STYLE_NAME[name])}`);
    }
    if (anyO2 && beatsAll(card, o2)) card.badges.push('Least O2');
    if (anyPower && beatsAll(card, power)) card.badges.push('Least power');
  }
  return cards;
}
