import { useEffect, useRef } from 'react';
import { getCoverage, loadCoverage, nearestTile, tileUrl } from '@/data/coverage';
import { latToPx, lonToPx, metresPerPixel } from '@/lib/geo';
import { cn } from '@/lib/cn';
import { useApp } from '@/store';
import { mapToneLut } from '@/engines/grading';

/** The zoom of the tiles the minimap is drawn from: about 5 m a pixel. */
const ZOOM = 14;
/** Decoded tiles kept for the minimap: a few around the viewer are all it ever shows. */
const KEEP = 12;
const FILTER = 'brightness(1.75) saturate(1.2) contrast(1.08)';
const ACCENT = '#f08a4b';
/** The map's shadow lift, so the minimap's ground reads as the map's does (Jezero's floor is dark basalt). */
const TONE = mapToneLut(1);

const tiles = new Map<string, Promise<{ bitmap: ImageBitmap; sx: number; sy: number; size: number } | null>>();

/** A z14 tile from the shipped package, or the part of its nearest ancestor that covers it. */
function tileAt(x: number, y: number): Promise<{ bitmap: ImageBitmap; sx: number; sy: number; size: number } | null> {
  const key = `${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const made = (async () => {
    const cov = getCoverage() ?? (await loadCoverage());
    const ref = cov ? nearestTile(cov, ['img', 'planetImg'], ZOOM, x, y) : null;
    if (!cov || !ref) return null;
    const res = await fetch(tileUrl(cov, ref));
    if (!res.ok) return null;
    const raw = await createImageBitmap(await res.blob());
    // Toned once, as it arrives: 256 by 256 pixels, a fraction of a millisecond.
    const canvas = new OffscreenCanvas(raw.width, raw.height);
    const c2 = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2) return null;
    c2.drawImage(raw, 0, 0);
    raw.close();
    const image = c2.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = TONE[px[i]!]!;
      px[i + 1] = TONE[px[i + 1]!]!;
      px[i + 2] = TONE[px[i + 2]!]!;
    }
    const bitmap = await createImageBitmap(image);
    const dz = ZOOM - ref.z;
    const size = 256 / 2 ** dz;
    return { bitmap, sx: (x - (ref.x << dz)) * size, sy: (y - (ref.y << dz)) * size, size };
  })().catch(() => null);
  tiles.set(key, made);
  while (tiles.size > KEEP) {
    const oldest = tiles.keys().next().value as string;
    const entry = tiles.get(oldest);
    tiles.delete(oldest);
    void entry?.then((t) => t?.bitmap.close());
  }
  return made;
}

/** A round number of metres for the scale bar, about a quarter of the width. */
function scaleFor(metresAcross: number): number {
  const target = metresAcross / 4;
  for (const m of [50, 100, 200, 250, 500, 1000, 2000]) if (m >= target) return m;
  return 5000;
}

interface MinimapProps {
  lon: number;
  lat: number;
  headingDeg: number;
  /** The route ahead, lon and lat; read when the minimap redraws. */
  route: () => readonly (readonly [number, number])[];
  /** Back to the map over this spot. */
  onOpenMap: () => void;
  className?: string;
}

/**
 * A small map of the ground around the viewer, north up, drawn from the shipped package tiles onto a canvas:
 * the viewer as an arrow pointing the way they look, the route ahead when riding, and a scale. Redrawn only
 * when the view reports a new place or heading (a few times a second at most), so it costs nothing per frame.
 * A click goes back to the map there.
 */
export function Minimap({ lon, lat, headingDeg, route, onOpenMap, className }: MinimapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const css = canvas.clientWidth || 200;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = Math.round(css * dpr);
      if (canvas.width !== size) canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Canvas pixels per map pixel of zoom 14: the view spans about 1.6 km whatever the canvas's size.
      const scale = size / 330;
      const cx = lonToPx(lon, ZOOM);
      const cy = latToPx(lat, ZOOM);
      const half = size / 2 / scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgb(122 74 48)';
      ctx.fillRect(0, 0, size, size);
      const x0 = Math.floor((cx - half) / 256);
      const x1 = Math.floor((cx + half) / 256);
      const y0 = Math.floor((cy - half) / 256);
      const y1 = Math.floor((cy + half) / 256);
      const pending: Promise<unknown>[] = [];
      // Jezero's floor is dark basalt: lifted well past the map's grade, so it reads at a glance this small.
      ctx.filter = FILTER;
      ctx.imageSmoothingQuality = 'high';
      for (let ty = y0; ty <= y1; ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
          const job = tileAt(tx, ty);
          pending.push(job);
          void job.then((t) => {
            if (!t || cancelled) return;
            try {
              ctx.filter = FILTER;
              ctx.drawImage(t.bitmap, t.sx, t.sy, t.size, t.size, (tx * 256 - cx) * scale + size / 2, (ty * 256 - cy) * scale + size / 2, 256 * scale + 0.5, 256 * scale + 0.5);
            } catch {
              // A tile evicted and closed meanwhile: the next redraw brings it back.
            }
          });
        }
      }
      // The overlay goes on once the ground under it is in.
      void Promise.all(pending).then(() => {
        if (cancelled) return;
        ctx.filter = 'none';
        const toCanvas = (plon: number, plat: number): [number, number] => [(lonToPx(plon, ZOOM) - cx) * scale + size / 2, (latToPx(plat, ZOOM) - cy) * scale + size / 2];
        const path = routeRef.current();
        if (path.length > 1) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          path.forEach(([plon, plat], i) => {
            const [x, y] = toCanvas(plon, plat);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.strokeStyle = 'rgb(0 0 0 / 0.55)';
          ctx.lineWidth = 4.5 * dpr;
          ctx.stroke();
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 2.2 * dpr;
          ctx.stroke();
        }
        // The base, as on the map: an amber square.
        const base = useApp.getState().base;
        const [bxp, byp] = toCanvas(base.lon, base.lat);
        if (bxp > -8 && bxp < size + 8 && byp > -8 && byp < size + 8) {
          const r = 5 * dpr;
          ctx.fillStyle = '#f2b632';
          ctx.strokeStyle = 'rgb(0 0 0 / 0.7)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.roundRect(bxp - r, byp - r, r * 2, r * 2, 2 * dpr);
          ctx.fill();
          ctx.stroke();
        }
        // The viewer: an arrow pointing the way they look.
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate((headingDeg * Math.PI) / 180);
        const a = 9 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, -a);
        ctx.lineTo(a * 0.68, a * 0.75);
        ctx.lineTo(0, a * 0.35);
        ctx.lineTo(-a * 0.68, a * 0.75);
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgb(0 0 0 / 0.7)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // Scale bar, bottom left.
        const mPerPx = metresPerPixel(lat, ZOOM) / scale;
        const metres = scaleFor(size * mPerPx);
        const len = metres / mPerPx;
        const bx = 8 * dpr;
        const by = size - 9 * dpr;
        ctx.strokeStyle = 'rgb(0 0 0 / 0.6)';
        ctx.lineWidth = 4 * dpr;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + len, by);
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.font = `600 ${10 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgb(0 0 0 / 0.9)';
        ctx.shadowBlur = 3 * dpr;
        ctx.textAlign = 'left';
        ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, bx, by - 5 * dpr);
        ctx.textAlign = 'center';
        ctx.fillText('N', size / 2, 13 * dpr);
        ctx.shadowBlur = 0;
      });
    };
    draw();
    return () => {
      cancelled = true;
    };
    // Redrawn at a new place or heading; the view reports both a few times a second at most.
  }, [lon, lat, headingDeg]);

  return (
    <button
      type="button"
      onClick={onOpenMap}
      aria-label="Map of the surroundings, north up. Open the map here"
      title="Open the map here"
      className={cn('panel pointer-events-auto block overflow-hidden p-0 transition-shadow hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-primary', className)}
    >
      <canvas ref={ref} className="block size-full" aria-hidden />
    </button>
  );
}
