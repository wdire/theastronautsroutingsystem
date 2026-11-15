/**
 * The cues. Each is a few oscillators and a little filtered noise, shaped by short envelopes: quiet, low in the
 * mix, and over quickly, except the flight down, which lasts as long as the flight.
 */
import { audio } from './engine';

type Out = NonNullable<ReturnType<typeof audio>>;

/**
 * How far ahead of the audio clock a cue is scheduled, s. A busy frame (Rover View closing, a map flight starting)
 * can hold the page past a tighter lead, and an envelope that starts in the past is skipped to its silent end.
 */
const LEAD = 0.04;

interface ToneOpts {
  freq: number;
  at?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  glideTo?: number;
  attack?: number;
  /** How much goes to the room, 0..1. */
  wet?: number;
  pan?: number;
  lowpass?: number;
}

/** One note with a fast rise and an exponential fall. */
function tone(o: Out, t0: number, { freq, at = 0, dur, gain, type = 'sine', glideTo, attack = 0.006, wet = 0.25, pan = 0, lowpass }: ToneOpts): void {
  const { c } = o;
  const t = t0 + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    node = node.connect(f);
  }
  node = node.connect(g);
  if (pan) {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    node = node.connect(p);
  }
  node.connect(o.out);
  if (wet > 0) {
    const w = c.createGain();
    w.gain.value = wet;
    node.connect(w).connect(o.wet);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  attack?: number;
  wet?: number;
}

/** A breath of filtered noise: a hiss, a puff of dust, a click's body. */
function hiss(o: Out, t0: number, { at = 0, dur, gain, type, from, to, q = 0.8, attack = 0.01, wet = 0.2 }: NoiseOpts): void {
  const { c } = o;
  const t = t0 + at;
  const src = c.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.out);
  if (wet > 0) {
    const w = c.createGain();
    w.gain.value = wet;
    g.connect(w).connect(o.wet);
  }
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

/* ---------- the flight between the planet and the ground ---------- */

export interface Playing {
  /** Fades the sound out over a moment and frees it. */
  stop(): void;
}

const SILENT: Playing = { stop() {} };

/**
 * A slow, warm chord: pairs of gently detuned saws per note, through a low-pass that opens and closes along the
 * flight, with a slow shimmer in its level. Tonal, so it reads as music under the picture, not as wind.
 */
function pad(
  o: Out,
  t: number,
  durationS: number,
  { notes, gain, cutoff, glide = 1 }: { notes: number[]; gain: [number, number][]; cutoff: [number, number][]; glide?: number },
): { bus: GainNode; sources: OscillatorNode[] } {
  const { c } = o;
  const end = t + durationS;
  const bus = c.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  for (const [at, v] of gain) bus.gain.linearRampToValueAtTime(v, t + at * durationS);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(cutoff[0]![1], t);
  for (const [at, f] of cutoff.slice(1)) lp.frequency.exponentialRampToValueAtTime(f, t + at * durationS);
  // A slow breath in the level, so the chord is alive.
  const trem = c.createGain();
  trem.gain.value = 1;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.35;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.12;
  lfo.connect(lfoDepth).connect(trem.gain);
  lp.connect(trem).connect(bus);
  bus.connect(o.out);
  const toRoom = c.createGain();
  toRoom.gain.value = 0.55;
  bus.connect(toRoom).connect(o.wet);
  const sources: OscillatorNode[] = [lfo];
  notes.forEach((f, i) => {
    for (const cents of [-6, 7]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(f * glide, end);
      osc.detune.value = cents;
      const g = c.createGain();
      // Higher notes a little quieter, so the chord sits on its root.
      g.gain.value = 0.5 / (1 + i * 0.45);
      const p = c.createStereoPanner();
      p.pan.value = (cents < 0 ? -1 : 1) * (0.15 + i * 0.08);
      osc.connect(g).connect(p).connect(lp);
      sources.push(osc);
    }
  });
  for (const s of sources) {
    s.start(t);
    s.stop(end + 2.5);
  }
  return { bus, sources };
}

function fadeOut(c: AudioContext, bus: GainNode, sources: AudioScheduledSourceNode[]): void {
  const now = c.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(bus.gain.value, now);
  bus.gain.setTargetAtTime(0, now, 0.15);
  for (const s of sources) {
    try {
      s.stop(now + 1);
    } catch {
      /* already stopped */
    }
  }
}

/**
 * The fall from orbit to Jezero: a soft low "thoom" answers the click, then a warm suspended chord swells and
 * brightens as the ground rushes in, and darkens and settles as the camera slows over the crater.
 */
export function descent(durationS: number): Playing {
  const o = audio();
  if (!o) return SILENT;
  const { c } = o;
  const t = c.currentTime + LEAD;
  // The answer to the click.
  tone(o, t, { freq: 98, glideTo: 49, dur: 1.1, gain: 0.26, attack: 0.01, wet: 0.4 });
  tone(o, t, { freq: 1318.5, dur: 1.2, gain: 0.02, wet: 0.8, attack: 0.005 });
  tone(o, t, { freq: 1975.5, at: 0.09, dur: 1.4, gain: 0.014, wet: 0.85, attack: 0.005 });
  // A2 E3 B3 E4 F#4: open and a little unresolved, until the landing chime answers it.
  const { bus, sources } = pad(o, t, durationS, {
    notes: [110, 164.81, 246.94, 329.63, 369.99],
    gain: [
      [0.3, 0.075],
      [0.6, 0.095],
      [0.92, 0.035],
      [1, 0.0001],
    ],
    cutoff: [
      [0, 260],
      [0.55, 2400],
      [1, 380],
    ],
  });
  // A low root under it, rising a semitone with the speed and coming back.
  const sub = c.createOscillator();
  sub.frequency.setValueAtTime(55, t);
  sub.frequency.linearRampToValueAtTime(58.27, t + durationS * 0.55);
  sub.frequency.linearRampToValueAtTime(55, t + durationS);
  const subG = c.createGain();
  subG.gain.setValueAtTime(0.0001, t);
  subG.gain.linearRampToValueAtTime(0.12, t + durationS * 0.5);
  subG.gain.linearRampToValueAtTime(0.0001, t + durationS);
  sub.connect(subG).connect(o.out);
  sub.start(t);
  sub.stop(t + durationS + 0.5);
  return { stop: () => fadeOut(c, bus, [...sources, sub]) };
}

/** The camera arriving over the ground: a soft settle and a two-note chime that resolves the chord, "you are here". */
export function touchdown(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 82.41, glideTo: 55, dur: 0.9, gain: 0.14, attack: 0.02, wet: 0.35 });
  tone(o, t, { at: 0.05, freq: 659.25, dur: 1.8, gain: 0.05, wet: 0.6 });
  tone(o, t, { at: 0.05, freq: 1318.5, dur: 0.9, gain: 0.01, wet: 0.7 });
  tone(o, t, { at: 0.22, freq: 880, dur: 2.4, gain: 0.045, wet: 0.7 });
}

/** The way back out to the planet: the chord lifts, opens and drifts away upward. */
export function ascent(durationS: number): Playing {
  const o = audio();
  if (!o) return SILENT;
  const { c } = o;
  const t = c.currentTime + LEAD;
  tone(o, t, { freq: 55, glideTo: 82.41, dur: 0.8, gain: 0.12, attack: 0.04, wet: 0.35 });
  // E3 B3 E4 A4: the landing chord turned upward, rising a little in pitch as it leaves.
  const { bus, sources } = pad(o, t, durationS, {
    notes: [164.81, 246.94, 329.63, 440],
    glide: 1.06,
    gain: [
      [0.25, 0.07],
      [0.5, 0.06],
      [1, 0.0001],
    ],
    cutoff: [
      [0, 500],
      [0.45, 2600],
      [1, 5000],
    ],
  });
  tone(o, t, { at: durationS * 0.6, freq: 1318.5, dur: 2.6, gain: 0.016, wet: 0.9, attack: 0.3 });
  return { stop: () => fadeOut(c, bus, sources) };
}

/* ---------- the helmet ---------- */

/** Rover View opening: a latch, the suit pressurising, and the visor display coming up. */
export function helmetOn(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  // The latch.
  hiss(o, t, { dur: 0.07, gain: 0.08, type: 'bandpass', from: 1400, q: 1.4, attack: 0.002, wet: 0.15 });
  tone(o, t, { freq: 150, glideTo: 70, dur: 0.16, gain: 0.16, attack: 0.002, wet: 0.1 });
  // Air in.
  hiss(o, t, { at: 0.08, dur: 0.95, gain: 0.04, type: 'highpass', from: 2400, to: 5200, attack: 0.08, wet: 0.1 });
  // The display: two quiet blips and a soft settle.
  tone(o, t, { at: 0.62, freq: 1318.5, dur: 0.12, gain: 0.03, wet: 0.4 });
  tone(o, t, { at: 0.72, freq: 1760, dur: 0.18, gain: 0.028, wet: 0.5 });
  tone(o, t, { at: 0.72, freq: 220, dur: 0.9, gain: 0.04, attack: 0.05, wet: 0.4 });
}

/** Back to the map: the seal lets go. */
export function helmetOff(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  hiss(o, t, { dur: 0.5, gain: 0.04, type: 'bandpass', from: 4200, to: 900, q: 0.7, attack: 0.01, wet: 0.15 });
  tone(o, t, { at: 0.04, freq: 1318.5, glideTo: 880, dur: 0.18, gain: 0.022, wet: 0.4 });
  tone(o, t, { at: 0.1, freq: 120, glideTo: 60, dur: 0.18, gain: 0.12, attack: 0.002, wet: 0.1 });
}

/* ---------- the tablet in hand ---------- */

let hum: { bus: GainNode; chirp: number; level: number; idleSince: number; stopAll: () => void } | null = null;

function startHum(o: Out): NonNullable<typeof hum> {
  const { c } = o;
  const bus = c.createGain();
  bus.gain.value = 0;
  bus.connect(o.out);
  const nodes: AudioScheduledSourceNode[] = [];
  // Mains-like hum, low and round.
  for (const [f, g] of [
    [98, 0.5],
    [196.4, 0.22],
    [294.9, 0.07],
  ] as const) {
    const osc = c.createOscillator();
    osc.frequency.value = f;
    const og = c.createGain();
    og.gain.value = g;
    osc.connect(og).connect(bus);
    nodes.push(osc);
  }
  // A little electronic flutter: narrow-band noise, wavering.
  const n = c.createBufferSource();
  n.buffer = o.noise;
  n.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 7;
  const ng = c.createGain();
  ng.gain.value = 0.09;
  const lfo = c.createOscillator();
  lfo.frequency.value = 5.3;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.05;
  lfo.connect(lfoG).connect(ng.gain);
  n.connect(bp).connect(ng).connect(bus);
  nodes.push(n, lfo);
  for (const s of nodes) s.start();
  const h = {
    bus,
    chirp: 0,
    level: 0,
    idleSince: 0,
    stopAll: () => {
      window.clearTimeout(h.chirp);
      for (const s of nodes) {
        try {
          s.stop(c.currentTime + 0.4);
        } catch {
          /* already stopped */
        }
      }
      window.setTimeout(() => bus.disconnect(), 600);
    },
  };
  // Now and then the screen talks to itself: a few faint data blips.
  const chirp = () => {
    h.chirp = window.setTimeout(chirp, 2600 + Math.random() * 4200);
    const live = audio();
    if (!live || h.level < 0.55) return;
    const t = live.c.currentTime + LEAD;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      tone(live, t, { at: i * 0.055, freq: 2200 + Math.floor(Math.random() * 4) * 330, dur: 0.035, gain: 0.006 * h.level, type: 'square', lowpass: 3800, wet: 0.2, pan: -0.2 });
    }
  };
  h.chirp = window.setTimeout(chirp, 1400);
  return h;
}

/** Hum gain at full view: well under everything else. */
const HUM_GAIN = 0.045;

/**
 * How much the tablet is being looked at, 0..1, called every frame while Rover View is open. The hum fades with
 * it, the screen gives a faint "tink" as it comes up into view, and everything is let go after a quiet spell.
 */
export function tabletLevel(level: number): void {
  const o = audio();
  if (!o) {
    if (hum && level === 0) {
      hum.stopAll();
      hum = null;
    }
    return;
  }
  const now = o.c.currentTime;
  if (!hum) {
    if (level < 0.02) return;
    hum = startHum(o);
  }
  if (Math.abs(level - hum.level) < 0.015) {
    if (level === 0 && hum.idleSince && now - hum.idleSince > 3) {
      hum.stopAll();
      hum = null;
    }
    return;
  }
  if (hum.level < 0.5 && level >= 0.5) tone(o, now + LEAD, { freq: 2093, dur: 0.14, gain: 0.018, wet: 0.5 });
  hum.level = level;
  hum.idleSince = level === 0 ? now : 0;
  hum.bus.gain.setTargetAtTime(HUM_GAIN * level * level, now, 0.12);
}

/** Rover View closing: the hum fades and is let go. */
export function releaseTablet(): void {
  const h = hum;
  if (!h) return;
  hum = null;
  const c = h.bus.context;
  h.bus.gain.setTargetAtTime(0, c.currentTime, 0.1);
  window.setTimeout(h.stopAll, 400);
}

/* ---------- alerts and missions ---------- */

/** Something worth knowing: one soft bell. */
export function advisory(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 987.77, dur: 1.2, gain: 0.06, wet: 0.55 });
  tone(o, t, { freq: 1975.5, dur: 0.5, gain: 0.012, wet: 0.6 });
}

/** Look at this: two notes, falling. */
export function caution(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 783.99, dur: 0.5, gain: 0.07, type: 'triangle', lowpass: 2600, wet: 0.45 });
  tone(o, t, { at: 0.17, freq: 587.33, dur: 0.9, gain: 0.07, type: 'triangle', lowpass: 2400, wet: 0.5 });
}

/** A decision is needed now: three short pulses over a low note, twice. Firm, not shrill. */
export function warning(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  for (const rep of [0, 0.62]) {
    for (let i = 0; i < 3; i++) {
      tone(o, t, { at: rep + i * 0.13, freq: 740, dur: 0.09, gain: 0.062, type: 'square', lowpass: 1700, attack: 0.004, wet: 0.3 });
    }
  }
  tone(o, t, { freq: 185, dur: 1.4, gain: 0.07, type: 'triangle', lowpass: 600, attack: 0.02, wet: 0.3 });
}

/** An alert answered: a small rising "done". */
export function acknowledge(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 659.25, dur: 0.18, gain: 0.035, wet: 0.35 });
  tone(o, t, { at: 0.08, freq: 987.77, dur: 0.4, gain: 0.035, wet: 0.45 });
}

/** A mission under way: a rising triad over a soft low push. */
export function missionStart(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 82, glideTo: 55, dur: 0.6, gain: 0.14, wet: 0.3 });
  [440, 554.37, 659.25, 880].forEach((f, i) => tone(o, t, { at: 0.04 + i * 0.075, freq: f, dur: 0.9 - i * 0.1, gain: 0.04, wet: 0.55 }));
}

/** A mission over: resolved, or, if called off, two low notes falling. */
export function missionEnd(done: boolean): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  if (done) {
    tone(o, t, { freq: 659.25, dur: 1.4, gain: 0.045, wet: 0.6 });
    tone(o, t, { at: 0.12, freq: 830.6, dur: 1.4, gain: 0.04, wet: 0.6 });
    tone(o, t, { at: 0.24, freq: 987.77, dur: 2.2, gain: 0.045, wet: 0.7 });
  } else {
    tone(o, t, { freq: 392, dur: 0.5, gain: 0.05, type: 'triangle', lowpass: 1800, wet: 0.4 });
    tone(o, t, { at: 0.2, freq: 293.66, dur: 1.0, gain: 0.05, type: 'triangle', lowpass: 1600, wet: 0.45 });
  }
}

/** A stop dropped on the map: the smallest tick. */
export function tick(): void {
  const o = audio();
  if (!o) return;
  const t = o.c.currentTime + LEAD;
  tone(o, t, { freq: 1760, glideTo: 1320, dur: 0.06, gain: 0.03, attack: 0.002, wet: 0.2 });
  hiss(o, t, { dur: 0.03, gain: 0.02, type: 'highpass', from: 5000, attack: 0.001, wet: 0 });
}
