/**
 * A small sound engine, every sound made here with Web Audio: no files to load. One context, made on the
 * visitor's first touch or key (browsers allow sound only after one), a master level the visitor can turn off,
 * a gentle compressor so nothing peaks, and a short synthetic room so the cues sit in a space instead of
 * clicking dry in the ear.
 */

const KEY = 'areo.sound.v1';
/** The whole mix, kept low: these are cues under the picture, not the picture. */
const MASTER = 0.55;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let room: ConvolverNode | null = null;
let noise: AudioBuffer | null = null;

const listeners = new Set<() => void>();
let on = readPref();

function readPref(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn(): boolean {
  return on;
}

export function setSoundOn(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts the visit */
  }
  if (ctx && master) master.gain.setTargetAtTime(next ? MASTER : 0, ctx.currentTime, 0.08);
  listeners.forEach((l) => l());
}

export function onSoundChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Two seconds of white noise, shared by every hiss, whoosh and hum. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** A soft, dark room: decaying stereo noise, about a second and a half long. */
function roomImpulse(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 1.6);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      // Low-passed as it goes, so the tail darkens the way a real one does.
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      d[i] = lp * Math.pow(1 - i / len, 3.2);
    }
  }
  return b;
}

function build(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  const c = new Ctor({ latencyHint: 'interactive' });
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  comp.connect(c.destination);
  master = c.createGain();
  master.gain.value = on ? MASTER : 0;
  master.connect(comp);
  room = c.createConvolver();
  room.buffer = roomImpulse(c);
  const wet = c.createGain();
  wet.gain.value = 0.32;
  room.connect(wet).connect(master);
  noise = noiseBuffer(c);
  ctx = c;
  // A hidden tab is silent, and costs nothing while it is.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  return c;
}

/**
 * Makes the context on the first gesture, so the first cue (the flight down, which a click starts) is heard.
 * Called once at start-up.
 */
export function armAudio(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    const c = build();
    if (c && c.state !== 'running' && !document.hidden) void c.resume();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

/** The live context, or null while there is none yet, the sound is off, or the tab is hidden. */
export function audio(): { c: AudioContext; out: AudioNode; wet: AudioNode; noise: AudioBuffer } | null {
  if (!on || !ctx || !master || !room || !noise) return null;
  if (ctx.state !== 'running') return null;
  return { c: ctx, out: master, wet: room, noise };
}
