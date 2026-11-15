import { useEffect, useRef } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { VisorHandle } from '@/visor';
import { useApp } from '@/store';
import { fmtClock, fmtDeg } from '@/lib/format';
import { marsTime } from '@/engines/marsTime';
import { MapCanvas } from './Minimap';
import { OVERLAY_NAMES } from './overlayNames';

/**
 * The tablet in the visitor's left hand while they walk in their own eyes. It is held where a person holds one:
 * low, in front of the chest, facing the eyes. It moves with the body, not with the gaze: looking ahead, its top
 * edge shows at the bottom of the screen; looking down brings it up into view, in perspective, as the head
 * tilts toward it. On it, a map of the ground around, with the overlay chosen in the corner menu.
 */

/** The tablet's size and where it is held, m, in the body's frame (x right, y up, -z ahead) from the eyes. */
const WIDTH_M = 0.34;
const HEIGHT_M = 0.2267;
const REACH_M = 0.37;
/** Below the horizon, degrees: where its middle is. Chosen so a level gaze shows about a tenth of the screen of it. */
const HELD_DEG = 39;
/** Its top leans a little away from the eyes, degrees, the way a tablet held in one hand does. */
const LEAN_DEG = 7;
/** A little left of the middle: it is held in the left hand. */
const LEFT_M = -0.025;
/** The element's own size in CSS pixels; the projection scales it to wherever the tablet is. */
const PX_W = 660;
const PX_H = 440;
/** How far down the gaze goes before the screen's own controls give way to the tablet, degrees. */
const HUD_FADE_DEG = [8, 20] as const;

type V3 = [number, number, number];

/** The four corners of the tablet on screen, or null when one is behind the eye. Order: top-left, top-right, bottom-right, bottom-left. */
function corners(lookDownDeg: number, fovDeg: number, w: number, h: number, sway: { x: number; y: number; roll: number }): [number, number][] | null {
  const A = (HELD_DEG * Math.PI) / 180;
  const t = A + (LEAN_DEG * Math.PI) / 180;
  const centre: V3 = [LEFT_M + sway.x, -REACH_M * Math.sin(A) + sway.y, -REACH_M * Math.cos(A)];
  const cr = Math.cos(sway.roll);
  const sr = Math.sin(sway.roll);
  // Across the tablet and up it; a little roll as the body sways.
  const u: V3 = [cr, sr, 0];
  const v: V3 = [-sr * Math.cos(t), Math.cos(t) * cr, -Math.sin(t)];
  const d = (lookDownDeg * Math.PI) / 180;
  const f = h / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const out: [number, number][] = [];
  for (const [a, b] of [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = centre[0] + (u[0] * a * WIDTH_M) / 2 + (v[0] * b * HEIGHT_M) / 2;
    const y = centre[1] + (u[1] * a * WIDTH_M) / 2 + (v[1] * b * HEIGHT_M) / 2;
    const z = centre[2] + (u[2] * a * WIDTH_M) / 2 + (v[2] * b * HEIGHT_M) / 2;
    // Into the camera's frame: the camera looks down by d.
    const yc = y * Math.cos(d) - z * Math.sin(d);
    const zc = y * Math.sin(d) + z * Math.cos(d);
    if (zc > -0.02) return null;
    out.push([w / 2 + (f * x) / -zc, h / 2 - (f * yc) / -zc]);
  }
  return out;
}

/** The CSS matrix that lays a PX_W by PX_H element onto a quadrilateral on screen (a projective map). */
function quadMatrix(q: [number, number][]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const m = [a / PX_W, d / PX_W, 0, g / PX_W, b / PX_H, e / PX_H, 0, hh / PX_H, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((n) => (Number.isFinite(n) ? n.toFixed(8) : '0')).join(',')})`;
}

interface TabletProps {
  handle: () => VisorHandle | null;
  lon: number;
  lat: number;
  headingDeg: number;
  route: () => readonly (readonly [number, number])[];
  onOpenMap: () => void;
  /** The element whose `[data-hud-fade]` children give way as the gaze goes down to the tablet. */
  hud: () => HTMLElement | null;
}

export function Tablet({ handle, lon, lat, headingDeg, route, onOpenMap, hud }: TabletProps) {
  const ref = useRef<HTMLDivElement>(null);
  const overlay = useApp((s) => s.layers.overlay);
  const minute = useApp((s) => Math.floor(s.utcMs / 60_000));
  const time = marsTime(minute * 60_000, lon);

  useEffect(() => {
    let raf = 0;
    let lastFade = -1;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = ref.current;
      const view = handle()?.view();
      const root = hud();
      if (!el || !view) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      // A walk's step bobs it, and a turn leaves it a moment behind the head.
      const step = view.walkPhase * Math.PI * 2;
      const sway = {
        x: Math.sin(step) * 0.006 * view.walk - Math.max(-0.05, Math.min(0.05, view.yawRate * 0.018)),
        y: Math.sin(step * 2) * 0.005 * view.walk,
        roll: Math.sin(step) * 0.012 * view.walk - Math.max(-0.06, Math.min(0.06, view.yawRate * 0.02)),
      };
      const q = view.ownEyes ? corners(view.lookDownDeg, view.fovDeg, w, h, sway) : null;
      const shown = q !== null && Math.min(...q.map((p) => p[1])) < h;
      el.style.visibility = shown ? 'visible' : 'hidden';
      if (q && shown) el.style.transform = quadMatrix(q);
      // The screen's own controls fade as the gaze goes down to the tablet, and come back as it lifts.
      const fade = view.ownEyes ? Math.max(0, Math.min(1, (view.lookDownDeg - HUD_FADE_DEG[0]) / (HUD_FADE_DEG[1] - HUD_FADE_DEG[0]))) : 0;
      if (root && Math.abs(fade - lastFade) > 0.01) {
        lastFade = fade;
        root.querySelectorAll<HTMLElement>('[data-hud-fade]').forEach((n) => {
          n.style.opacity = String(1 - fade);
          n.style.pointerEvents = fade > 0.5 ? 'none' : '';
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      hud()
        ?.querySelectorAll<HTMLElement>('[data-hud-fade]')
        .forEach((n) => {
          n.style.opacity = '';
          n.style.pointerEvents = '';
        });
    };
  }, [handle, hud]);

  const name = OVERLAY_NAMES[overlay];

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 origin-top-left select-none"
      style={{ width: PX_W, height: PX_H, visibility: 'hidden', willChange: 'transform' }}
      aria-label="Tablet: a map of the ground around you"
      role="img"
    >
      <Glove side="back" />
      {/* The device: a graphite shell with a thin lit edge, a camera dot, and a status light. */}
      <div
        className="absolute inset-0 rounded-[34px] p-[16px]"
        style={{
          background: 'linear-gradient(160deg, #3a3d42 0%, #1d1f23 38%, #141518 100%)',
          boxShadow: '0 30px 60px rgb(0 0 0 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.18), inset 0 0 0 1px rgb(255 255 255 / 0.06)',
        }}
      >
        <span className="absolute top-[7px] left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-[#0b0c0e] ring-1 ring-white/10" />
        <span className="absolute top-[7px] right-[44px] h-[3px] w-[18px] rounded-full bg-[#f08a4b] shadow-[0_0_6px_#f08a4b]" />
        <div className="relative size-full overflow-hidden rounded-[20px] bg-[#120c09] ring-1 ring-black/60">
          <MapCanvas lon={lon} lat={lat} headingDeg={headingDeg} route={route} spanM={1800} overlay={overlay} />
          {/* A status bar along the top of the screen. */}
          <div className="figure absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pt-2 pb-5 text-[13px] font-semibold tracking-wide text-white/90">
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-[#7fd18b] shadow-[0_0_6px_#7fd18b]" />
              NAV
              <span className="font-medium text-white/60">
                {Math.abs(lat).toFixed(4)}° {lat >= 0 ? 'N' : 'S'} {Math.abs(lon).toFixed(4)}° {lon >= 0 ? 'E' : 'W'}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-white/60">HDG {fmtDeg(headingDeg)}</span>
              {fmtClock(time.ltstH)} LTST
            </span>
          </div>
          {name ? (
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-[12px] font-semibold text-white/90 ring-1 ring-white/10">{name}</span>
          ) : null}
          <button
            type="button"
            onClick={onOpenMap}
            className="pointer-events-auto absolute right-3 bottom-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-black/65 px-3 text-[12px] font-semibold text-white/90 ring-1 ring-white/15 hover:bg-black/80"
          >
            <MapIcon className="size-3.5" aria-hidden />
            Open the map
          </button>
          {/* A faint sheen across the glass. */}
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgb(255_255_255/0.07)_0%,transparent_32%,transparent_70%,rgb(255_255_255/0.04)_100%)]" />
        </div>
      </div>
      <Glove side="front" />
    </div>
  );
}

/**
 * The suited left hand holding the tablet's left edge: fingers and palm behind it, the thumb across the bezel in
 * front, the cuff and sleeve running down out of view. Drawn in the tablet's own plane, so it takes the same
 * perspective as the tablet.
 */
function Glove({ side }: { side: 'back' | 'front' }) {
  return (
    <svg className="absolute" style={{ left: -150, top: 150, width: 260, height: 520, overflow: 'visible' }} viewBox="0 0 260 520" aria-hidden>
      <defs>
        <linearGradient id="glove-fabric" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#bdb7ad" />
          <stop offset="0.45" stopColor="#ece7de" />
          <stop offset="1" stopColor="#cfc9be" />
        </linearGradient>
        <linearGradient id="glove-sleeve" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a9a399" />
          <stop offset="0.5" stopColor="#e6e1d8" />
          <stop offset="1" stopColor="#c2bcb1" />
        </linearGradient>
        <linearGradient id="glove-ring" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5d6066" />
          <stop offset="0.5" stopColor="#b9bcc2" />
          <stop offset="1" stopColor="#70737a" />
        </linearGradient>
        <linearGradient id="glove-thumb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2eee6" />
          <stop offset="1" stopColor="#c4beb3" />
        </linearGradient>
      </defs>
      {side === 'back' ? (
        <g>
          {/* Sleeve, from below the screen up to the wrist. */}
          <path d="M18 520 C 22 420, 40 350, 70 300 L 168 300 C 176 360, 182 440, 178 520 Z" fill="url(#glove-sleeve)" />
          <path d="M60 330 C 95 322, 140 322, 172 330" stroke="#d2662f" strokeWidth="9" fill="none" opacity="0.9" />
          {/* The wrist bearing. */}
          <rect x="66" y="270" width="110" height="34" rx="10" fill="url(#glove-ring)" />
          <rect x="66" y="282" width="110" height="5" fill="#3d3f44" opacity="0.6" />
          {/* Palm and the backs of the fingers, wrapped round the tablet's edge. */}
          <path d="M80 280 C 70 230, 82 170, 112 120 C 130 92, 156 82, 170 92 L 172 278 Z" fill="url(#glove-fabric)" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={142} y={104 + i * 38} width={34} height={33} rx={15} fill="url(#glove-fabric)" stroke="#9d978d" strokeWidth="1.5" />
          ))}
          <path d="M96 200 C 104 170, 118 146, 136 128" stroke="#9d978d" strokeWidth="2" fill="none" opacity="0.7" />
        </g>
      ) : (
        <g>
          {/* The thumb, across the bezel. */}
          <path d="M112 262 C 120 228, 136 196, 160 178 C 172 169, 186 170, 190 182 C 194 193, 186 204, 176 212 C 158 228, 146 252, 140 276 Z" fill="url(#glove-thumb)" stroke="#8f897f" strokeWidth="1.5" />
          <path d="M150 210 C 160 198, 172 190, 182 188" stroke="#9d978d" strokeWidth="1.5" fill="none" opacity="0.8" />
          <ellipse cx="178" cy="186" rx="9" ry="7" fill="#6e6a64" opacity="0.55" />
        </g>
      )}
    </svg>
  );
}
