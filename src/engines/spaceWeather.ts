// Relative import on purpose: this module is also bundled into the function under api/.
import { nasaUrl } from '../lib/nasa';

/**
 * Live space weather for Mars, summarised from NASA’s DONKI database (Space Weather Database Of
 * Notifications, Knowledge, Information): coronal mass ejections that the WSA-ENLIL model sends to Mars,
 * particle events recorded by an instrument at Mars, and the strongest recent solar flare.
 *
 * The feed is untrusted input: every field is checked before it is used.
 */

/** What the app fetches: one array per DONKI feed, or null where that feed did not answer. */
export interface DonkiFeed {
  fetched: string;
  enlil: unknown[] | null;
  sep: unknown[] | null;
  flr: unknown[] | null;
}

export type FeedName = 'enlil' | 'sep' | 'flr';
/** 'unknown' when the one feed that decides the status (ENLIL) did not answer. */
export type SpaceWeatherStatus = 'quiet' | 'watch' | 'warning' | 'unknown';

export interface CmeAtMars {
  arrivalUtcMs: number;
  /** The model has the cloud’s flank, not its centre, reaching Mars. */
  glancing: boolean;
  /** Speed of the fastest ejection in the run, km/s. */
  speedKms: number | null;
  link: string | null;
}

export interface ParticleEvent {
  utcMs: number;
}

export interface Flare {
  peakUtcMs: number;
  classType: string;
}

export interface SpaceWeather {
  status: SpaceWeatherStatus;
  /** One plain sentence. */
  headline: string;
  cmes: CmeAtMars[];
  particlesAtMars: ParticleEvent[];
  /** Particle events in the last week seen elsewhere (Earth, STEREO A) and not at Mars. */
  particlesElsewhere: number;
  strongestFlare: Flare | null;
  missing: FeedName[];
  fetchedUtcMs: number | null;
  /** The moment this summary describes. */
  asOfUtcMs: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A cloud takes about a day to pass: half a day either side of the modelled arrival counts as "here". */
export const CME_PASSAGE_MS = 12 * HOUR;
const CME_LISTED_BACK_MS = 2 * DAY;
const CME_WATCH_AHEAD_MS = 7 * DAY;
const CME_WARN_AHEAD_MS = DAY;
const SEP_LISTED_BACK_MS = 7 * DAY;
const SEP_WARN_BACK_MS = 2 * DAY;
/** Instruments that sit at Mars: MAVEN in orbit, Curiosity’s RAD on the ground. */
const AT_MARS = /\b(MAVEN|MSL|Mars)\b/i;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function time(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** A number that orders flare classes: C9 < M1 < M2 < X1. Zero for anything unreadable. */
export function flareStrength(classType: string): number {
  const m = /^([ABCMX])(\d+(?:\.\d+)?)?/.exec(classType.trim().toUpperCase());
  if (!m) return 0;
  const decade = 'ABCMX'.indexOf(m[1] ?? '');
  return 10 ** decade * (m[2] ? Number(m[2]) : 1);
}

function cmesAtMars(enlil: unknown[], nowMs: number): CmeAtMars[] {
  // The same ejection is modelled several times as measurements improve: keep the newest run per arrival hour.
  const byHour = new Map<number, { cme: CmeAtMars; modelled: number }>();
  for (const raw of enlil) {
    const run = rec(raw);
    if (!run) continue;
    const modelled = time(run.modelCompletionTime) ?? 0;
    let speed: number | null = null;
    for (const input of list(run.cmeInputs)) {
      const s = num(rec(input)?.speed);
      if (s !== null && (speed === null || s > speed)) speed = s;
    }
    for (const rawImpact of list(run.impactList)) {
      const impact = rec(rawImpact);
      if (!impact || str(impact.location) !== 'Mars') continue;
      const arrivalUtcMs = time(impact.arrivalTime);
      if (arrivalUtcMs === null) continue;
      if (arrivalUtcMs < nowMs - CME_LISTED_BACK_MS) continue;
      const hour = Math.round(arrivalUtcMs / HOUR);
      const seen = byHour.get(hour);
      if (seen && seen.modelled >= modelled) continue;
      byHour.set(hour, {
        modelled,
        cme: { arrivalUtcMs, glancing: impact.isGlancingBlow === true, speedKms: speed, link: nasaUrl(run.link) },
      });
    }
  }
  return [...byHour.values()].map((v) => v.cme).sort((a, b) => a.arrivalUtcMs - b.arrivalUtcMs);
}

function particles(sep: unknown[], nowMs: number): { atMars: ParticleEvent[]; elsewhere: number } {
  const atMars: ParticleEvent[] = [];
  let elsewhere = 0;
  for (const raw of sep) {
    const event = rec(raw);
    const utcMs = time(event?.eventTime);
    if (!event || utcMs === null || utcMs > nowMs || utcMs < nowMs - SEP_LISTED_BACK_MS) continue;
    const instruments = list(event.instruments)
      .map((i) => str(rec(i)?.displayName))
      .filter((n): n is string => n !== null);
    if (instruments.some((n) => AT_MARS.test(n))) atMars.push({ utcMs });
    else elsewhere += 1;
  }
  atMars.sort((a, b) => b.utcMs - a.utcMs);
  return { atMars, elsewhere };
}

function strongestFlare(flr: unknown[]): Flare | null {
  let best: Flare | null = null;
  let bestStrength = flareStrength('M1') - 1e-9;
  for (const raw of flr) {
    const flare = rec(raw);
    const classType = str(flare?.classType);
    const peakUtcMs = time(flare?.peakTime) ?? time(flare?.beginTime);
    if (!flare || !classType || peakUtcMs === null) continue;
    const strength = flareStrength(classType);
    if (strength <= bestStrength) continue;
    bestStrength = strength;
    best = { peakUtcMs, classType };
  }
  return best;
}

/** "in 3 days", "in 5 hours", "2 hours ago": whole units, the way a person would say it. */
export function relativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const [n, unit] = abs >= 1.5 * DAY ? [Math.round(abs / DAY), 'day'] : abs >= 1.5 * HOUR ? [Math.round(abs / HOUR), 'hour'] : [Math.max(1, Math.round(abs / 60_000)), 'minute'];
  const words = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${words}` : `${words} ago`;
}

export function summarizeSpaceWeather(feed: DonkiFeed, nowMs: number): SpaceWeather {
  const missing = (['enlil', 'sep', 'flr'] as const).filter((name) => !Array.isArray(feed[name]));
  const cmes = cmesAtMars(list(feed.enlil), nowMs);
  const { atMars, elsewhere } = particles(list(feed.sep), nowMs);

  const here = cmes.find((c) => Math.abs(c.arrivalUtcMs - nowMs) <= CME_PASSAGE_MS);
  const due = cmes.find((c) => c.arrivalUtcMs > nowMs);
  const recentParticles = atMars.find((p) => p.utcMs >= nowMs - SEP_WARN_BACK_MS);

  let status: SpaceWeatherStatus = 'quiet';
  const passed = cmes.findLast((c) => c.arrivalUtcMs <= nowMs);
  let headline = passed ? `A solar storm cloud reached Mars ${relativeTime(passed.arrivalUtcMs, nowMs)} and has passed. Nothing more is forecast this week.` : 'No solar storm is forecast at Mars this week.';
  if (recentParticles) {
    status = 'warning';
    headline = `Energetic particles were recorded at Mars ${relativeTime(recentParticles.utcMs, nowMs)}.`;
  } else if (here) {
    status = 'warning';
    headline = here.arrivalUtcMs > nowMs ? `A solar storm cloud reaches Mars ${relativeTime(here.arrivalUtcMs, nowMs)}.` : `A solar storm cloud reached Mars ${relativeTime(here.arrivalUtcMs, nowMs)} and is still passing.`;
  } else if (due && due.arrivalUtcMs - nowMs <= CME_WARN_AHEAD_MS) {
    status = 'warning';
    headline = `A solar storm cloud reaches Mars ${relativeTime(due.arrivalUtcMs, nowMs)}.`;
  } else if (due && due.arrivalUtcMs - nowMs <= CME_WATCH_AHEAD_MS) {
    status = 'watch';
    headline = `A solar storm cloud is forecast to reach Mars ${relativeTime(due.arrivalUtcMs, nowMs)}.`;
  } else if (missing.includes('enlil')) {
    status = 'unknown';
    headline = 'The forecast for Mars did not load, so storms on their way cannot be ruled out.';
  }

  return {
    status,
    headline,
    cmes,
    particlesAtMars: atMars,
    particlesElsewhere: elsewhere,
    strongestFlare: strongestFlare(list(feed.flr)),
    missing,
    fetchedUtcMs: time(feed.fetched),
    asOfUtcMs: nowMs,
  };
}

/** CMEs forecast at Mars while a crew is out, counting half a day either side of each arrival. */
export function cmesDuring(sw: SpaceWeather, departUtcMs: number, arriveUtcMs: number): CmeAtMars[] {
  return sw.cmes.filter((c) => c.arrivalUtcMs >= departUtcMs - CME_PASSAGE_MS && c.arrivalUtcMs <= arriveUtcMs + CME_PASSAGE_MS);
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The three DONKI questions the app asks, as feed path and query string. Dates are whole UTC days. */
export function donkiQueries(nowMs: number): Record<FeedName, { path: string; query: string }> {
  const range = (backDays: number, aheadDays: number) => `startDate=${ymd(nowMs - backDays * DAY)}&endDate=${ymd(nowMs + aheadDays * DAY)}`;
  return {
    enlil: { path: 'WSAEnlilSimulations', query: range(12, 7) },
    sep: { path: 'SEP', query: range(14, 0) },
    flr: { path: 'FLR', query: range(3, 0) },
  };
}

/** DONKI answers an empty body, not an empty list, when nothing happened. Null when the text is not a list. */
export function parseDonkiList(text: string): unknown[] | null {
  if (text.trim() === '') return [];
  try {
    const data: unknown = JSON.parse(text);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
