import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useApp } from '@/store';
import { whenMapReady } from '@/map/instance';
import { globeView, prefersReducedMotion } from '@/map/camera';

/**
 * The sky behind the opening globe. It sits under the map canvas, which is transparent outside the planet,
 * so Mars hides whatever passes behind it, shooting stars included.
 *
 * Two canvases: the faint, dense stars are drawn once per size and moved by CSS; the brighter stars twinkle
 * and are redrawn each frame, together with the occasional meteor. Nothing runs once the map covers the sky.
 */

const MAX_DPR = 2;
/** Bright stars per million CSS pixels; faint ones are drawn at ten times that. */
const BRIGHT_PER_MPX = 95;
const FAINT_PER_MPX = 950;
/** How far the sky shifts with the pointer, CSS px, at the screen edge. */
const PARALLAX_NEAR = 9;
const PARALLAX_FAR = 4;
/** The globe is 432 px across at zoom 1.6 and doubles with every zoom level (see globeView). */
const GLOBE_PX_AT_1_6 = 432;

type Tint = 0 | 1 | 2;
const TINTS: Record<Tint, string> = { 0: '255 252 246', 1: '255 226 196', 2: '206 222 255' };

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  tint: Tint;
  speed: number;
  phase: number;
  depth: number;
}

interface Meteor {
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
  age: number;
  life: number;
}

/** A small seeded generator, so the sky is the same on every visit. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTint(r: number): Tint {
  return r < 0.72 ? 0 : r < 0.88 ? 1 : 2;
}

/** A soft round sprite for each tint: a hard core and a short glow. */
function makeSprites(): Record<Tint, HTMLCanvasElement> {
  const out = {} as Record<Tint, HTMLCanvasElement>;
  for (const tint of [0, 1, 2] as Tint[]) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgb(${TINTS[tint]} / 1)`);
    grad.addColorStop(0.14, `rgb(${TINTS[tint]} / 0.9)`);
    grad.addColorStop(0.32, `rgb(${TINTS[tint]} / 0.22)`);
    grad.addColorStop(1, `rgb(${TINTS[tint]} / 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    out[tint] = c;
  }
  return out;
}

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number, dpr: number): CanvasRenderingContext2D {
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Faint stars, drawn once per size, with a margin so the parallax never shows an edge. */
function drawFaint(c: HTMLCanvasElement, w: number, h: number, dpr: number, margin: number): void {
  const W = w + margin * 2;
  const H = h + margin * 2;
  const ctx = sizeCanvas(c, W, H, dpr);
  const rand = seeded(7);
  const count = Math.round(((W * H) / 1e6) * FAINT_PER_MPX);
  for (let i = 0; i < count; i++) {
    const r = rand();
    // Most faint stars are at the limit of seeing; a few are a little brighter.
    const alpha = 0.12 + Math.pow(rand(), 2.6) * 0.5;
    const size = 0.45 + rand() * 0.5;
    ctx.fillStyle = `rgb(${TINTS[pickTint(r)]} / ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makeBright(w: number, h: number, margin: number): Star[] {
  const rand = seeded(42);
  const W = w + margin * 2;
  const H = h + margin * 2;
  const count = Math.round(((W * H) / 1e6) * BRIGHT_PER_MPX);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const mag = Math.pow(rand(), 3);
    stars.push({
      x: rand() * W - margin,
      y: rand() * H - margin,
      // Sprite size: the core is about a seventh of it.
      size: 5 + mag * 11,
      alpha: 0.45 + mag * 0.55,
      tint: pickTint(rand()),
      speed: 0.6 + rand() * 1.8,
      phase: rand() * Math.PI * 2,
      depth: 0.6 + rand() * 0.4,
    });
  }
  return stars;
}

interface Disc {
  x: number;
  y: number;
  r: number;
}

/**
 * A meteor starts in open sky, never behind the planet, so it is seen to begin; it may then run behind Mars.
 * Mostly in the upper part of the sky, falling left or right at a shallow angle.
 */
function spawnMeteor(w: number, h: number, globe: Disc | null): Meteor {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 8; i++) {
    x = w * (0.04 + Math.random() * 0.92);
    y = h * (0.04 + Math.random() * 0.5);
    if (!globe || Math.hypot(x - globe.x, y - globe.y) > globe.r * 1.15) break;
  }
  // Fall away from the planet when it is near, so most of the streak is in open sky.
  const leftward = globe ? x < globe.x : Math.random() < 0.5;
  const angle = ((leftward ? 152 : 28) + (Math.random() - 0.5) * 26) * (Math.PI / 180);
  const speed = 800 + Math.random() * 600;
  return {
    x,
    y,
    dx: Math.cos(angle) * speed,
    dy: Math.sin(angle) * speed,
    length: 130 + Math.random() * 150,
    age: 0,
    life: 0.6 + Math.random() * 0.5,
  };
}

function drawMeteor(ctx: CanvasRenderingContext2D, m: Meteor, glow: HTMLCanvasElement): void {
  const t = m.age / m.life;
  // In quickly, out slowly, as the trail burns down.
  const a = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.88);
  const v = Math.hypot(m.dx, m.dy);
  const grow = Math.min(1, t * 3);
  const tx = m.x - (m.dx / v) * m.length * grow;
  const ty = m.y - (m.dy / v) * m.length * grow;
  const grad = ctx.createLinearGradient(tx, ty, m.x, m.y);
  grad.addColorStop(0, 'rgb(255 236 214 / 0)');
  grad.addColorStop(0.7, `rgb(255 240 222 / ${(0.45 * a).toFixed(3)})`);
  grad.addColorStop(1, `rgb(255 255 255 / ${a.toFixed(3)})`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(m.x, m.y);
  ctx.stroke();
  // A small bright head.
  ctx.globalAlpha = a;
  ctx.drawImage(glow, m.x - 7, m.y - 7, 14, 14);
  ctx.globalAlpha = 1;
}

/** Where the globe is on screen and how big, from the map's padding and zoom. */
function globeOnScreen(map: MapLibreMap): Disc {
  const el = map.getContainer();
  const { left = 0, right = 0, top = 0, bottom = 0 } = map.getPadding();
  const w = el.clientWidth;
  const h = el.clientHeight;
  return {
    x: left + (w - left - right) / 2,
    y: top + (h - top - bottom) / 2,
    r: (GLOBE_PX_AT_1_6 * Math.pow(2, map.getZoom() - 1.6)) / 2,
  };
}

export function Starfield() {
  const rootRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLCanvasElement>(null);
  const nearRef = useRef<HTMLCanvasElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current!;
    const far = farRef.current!;
    const near = nearRef.current!;
    const halo = haloRef.current!;
    const still = prefersReducedMotion();
    const finePointer = matchMedia('(pointer: fine)').matches;
    const margin = still || !finePointer ? 0 : PARALLAX_NEAR + 2;
    const sprites = makeSprites();

    let w = 0;
    let h = 0;
    let dpr = 1;
    let ctx: CanvasRenderingContext2D | null = null;
    let stars: Star[] = [];
    let map: MapLibreMap | null = null;
    let globe: Disc | null = null;
    let alive = true;

    const layout = () => {
      w = root.clientWidth;
      h = root.clientHeight;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      drawFaint(far, w, h, dpr, margin);
      far.style.width = `${w + margin * 2}px`;
      far.style.height = `${h + margin * 2}px`;
      ctx = sizeCanvas(near, w, h, dpr);
      stars = makeBright(w, h, margin);
    };

    // Pointer parallax, eased toward where the pointer is.
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    const onPointer = (e: PointerEvent) => {
      tx = (e.clientX / w) * 2 - 1;
      ty = (e.clientY / h) * 2 - 1;
    };

    let meteors: Meteor[] = [];
    // The first one comes soon, so the sky is seen to be alive; then every few seconds.
    let nextMeteor = 1.6 + Math.random() * 1.2;

    const running = () => {
      const s = useApp.getState();
      return s.mode === 'globe' || s.flying;
    };

    const placeHalo = () => {
      // On the map the sky is covered; panning there should cost nothing here.
      if (!map || !running()) return;
      const g = (globe = globeOnScreen(map));
      const size = g.r * 2 * 1.7;
      halo.style.width = halo.style.height = `${size}px`;
      halo.style.transform = `translate3d(${g.x - size / 2}px, ${g.y - size / 2}px, 0)`;
      // The sky goes as the camera dives toward the ground, and comes back on the way out.
      const lift = map.getZoom() - globeView().zoom;
      root.style.opacity = String(Math.min(1, Math.max(0, 1 - (lift - 0.4) / 2.2)));
    };

    const draw = (time: number) => {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      const ox = -px * PARALLAX_NEAR;
      const oy = -py * PARALLAX_NEAR;
      for (const s of stars) {
        const twinkle = still ? 1 : 0.72 + 0.28 * Math.sin(time * s.speed + s.phase);
        ctx.globalAlpha = s.alpha * twinkle;
        const half = s.size / 2;
        ctx.drawImage(sprites[s.tint], s.x + ox * s.depth - half, s.y + oy * s.depth - half, s.size, s.size);
      }
      ctx.globalAlpha = 1;
      for (const m of meteors) drawMeteor(ctx, m, sprites[0]);
    };

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = 0;
      if (!alive || !running()) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const ease = 1 - Math.exp(-dt * 3);
      px += (tx - px) * ease;
      py += (ty - py) * ease;
      far.style.transform = `translate3d(${-margin - px * PARALLAX_FAR}px, ${-margin - py * PARALLAX_FAR}px, 0)`;

      nextMeteor -= dt;
      if (nextMeteor <= 0 && !useApp.getState().flying) {
        meteors.push(spawnMeteor(w, h, globe));
        nextMeteor = 3.5 + Math.random() * 6;
      }
      for (const m of meteors) {
        m.age += dt;
        m.x += m.dx * dt;
        m.y += m.dy * dt;
      }
      meteors = meteors.filter((m) => m.age < m.life);

      draw(now / 1000);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (still || raf || !running()) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    layout();
    draw(0);
    root.style.opacity = '1';
    start();

    const ro = new ResizeObserver(() => {
      layout();
      draw(performance.now() / 1000);
    });
    ro.observe(root);
    if (finePointer && !still) window.addEventListener('pointermove', onPointer, { passive: true });
    const unsubscribe = useApp.subscribe(
      (s) => s.mode === 'globe' || s.flying,
      (on) => {
        if (on) start();
      },
    );
    whenMapReady((m) => {
      if (!alive) return;
      map = m;
      placeHalo();
      m.on('move', placeHalo);
      m.on('resize', placeHalo);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubscribe();
      window.removeEventListener('pointermove', onPointer);
      map?.off('move', placeHalo);
      map?.off('resize', placeHalo);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-1000">
      <canvas ref={farRef} className="absolute top-0 left-0 will-change-transform" />
      <canvas ref={nearRef} className="absolute inset-0 size-full" />
      <div ref={haloRef} className="globe-halo absolute top-0 left-0" />
    </div>
  );
}
