import { useEffect, useRef, useState } from 'react';
import { getCoverage, loadCoverage, nearestTile, tileUrl } from '@/data/coverage';
import { loadGeology } from '@/data/datasets';
import type { GeoFeature } from '@/engines/geology';
import { latToPx, lonToPx, metresPerPixel } from '@/lib/geo';
import { cn } from '@/lib/cn';
import { useApp, type Overlay } from '@/store';
import { mapToneLut } from '@/engines/grading';
import { overlayTileFor, RASTER } from '@/map/layers/overlays';
import { toBitmap } from '@/map/protocol/common';
import { poolTile } from '@/map/protocol/pool';

/** The zoom of the tiles the minimap is drawn from: about 5 m a pixel. */
const ZOOM = 14;
/** Decoded tiles kept for the minimap: a few around the viewer are all it ever shows. */
const KEEP = 20;
const FILTER = 'brightness(1.75) saturate(1.2) contrast(1.08)';
const ACCENT = '#f08a4b';
/** The map's shadow lift, so the minimap's ground reads as the map's does (Jezero's floor is dark basalt). */
const TONE = mapToneLut(1);

interface Piece {
  bitmap: ImageBitmap;
  sx: number;
  sy: number;
  size: number;
}

const tiles = new Map<string, Promise<Piece | null>>();

/** A z14 tile from the shipped package, or the part of its nearest ancestor that covers it. */
function tileAt(x: number, y: number): Promise<Piece | null> {
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

/** Overlay tiles as they arrive, by overlay/z/x/y: resolved ones are drawn at once, the rest on arrival. */
const overlayTiles = new Map<string, { done: boolean; bitmap: ImageBitmap | null; made: Promise<void> }>();
const OVERLAY_KEEP = 24;

function overlayAt(overlay: Exclude<Overlay, 'none' | 'geology'>, z: number, x: number, y: number) {
  const key = `${overlay}/${z}/${x}/${y}`;
  const hit = overlayTiles.get(key);
  if (hit) return hit;
  const entry: { done: boolean; bitmap: ImageBitmap | null; made: Promise<void> } = { done: false, bitmap: null, made: Promise.resolve() };
  entry.made = overlayTileFor(overlay, z, x, y, new AbortController().signal)
    .then(toBitmap)
    .then((bitmap) => {
      entry.bitmap = bitmap;
    })
    .catch(() => undefined)
    .finally(() => {
      entry.done = true;
    });
  overlayTiles.set(key, entry);
  while (overlayTiles.size > OVERLAY_KEEP) {
    const oldest = overlayTiles.keys().next().value as string;
    const old = overlayTiles.get(oldest);
    overlayTiles.delete(oldest);
    if (old?.done) old.bitmap?.close();
  }
  return entry;
}

/**
 * Sharper ground for a larger map (the tablet's): the map's own tiles at a finer zoom, with the live CTX and
 * HiRISE detail the shipped package does not carry. Drawn over the package's ground as they arrive.
 */
const fineTiles = new Map<string, { done: boolean; bitmap: ImageBitmap | null; made: Promise<void> }>();
const FINE_KEEP = 96;
/** Counts for the checks: fine tiles asked for, arrived, and arrived with an image. */
const fineStats = { asked: 0, done: 0, ok: 0 };
if (typeof window !== 'undefined') (window as unknown as { __areoFine?: typeof fineStats }).__areoFine = fineStats;

function fineAt(kind: 'img' | 'hd', z: number, x: number, y: number) {
  const key = `${kind}/${z}/${x}/${y}`;
  const hit = fineTiles.get(key);
  if (hit) {
    fineTiles.delete(key);
    fineTiles.set(key, hit);
    return hit;
  }
  const entry: { done: boolean; bitmap: ImageBitmap | null; made: Promise<void> } = { done: false, bitmap: null, made: Promise.resolve() };
  fineStats.asked += 1;
  entry.made = poolTile(kind, z, x, y, 'full', new AbortController().signal)
    .then((served) => {
      entry.bitmap = served.bitmap;
      fineStats.ok += 1;
    })
    .catch(() => undefined)
    .finally(() => {
      entry.done = true;
      fineStats.done += 1;
    });
  fineTiles.set(key, entry);
  while (fineTiles.size > FINE_KEEP) {
    const oldest = fineTiles.keys().next().value as string;
    const old = fineTiles.get(oldest);
    fineTiles.delete(oldest);
    if (old?.done) old.bitmap?.close();
  }
  return entry;
}

/** The geologic map's polygons with their bounds and colours, read once. */
let geology: Promise<{ feature: GeoFeature; colour: string; box: [number, number, number, number] }[]> | null = null;
function geologyShapes() {
  geology ??= loadGeology().then((geo) => {
    const colour = new Map(geo.units.map((u) => [u.code, u.colour]));
    return geo.features.features.map((feature) => {
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
      for (const ring of rings)
        for (const [lon = 0, lat = 0] of ring) {
          box[0] = Math.min(box[0], lon);
          box[1] = Math.min(box[1], lat);
          box[2] = Math.max(box[2], lon);
          box[3] = Math.max(box[3], lat);
        }
      return { feature, colour: colour.get(feature.properties.unit) ?? '#888888', box };
    });
  });
  return geology;
}

/** A round number of metres for the scale bar, about a quarter of the width. */
function scaleFor(metresAcross: number): number {
  const target = metresAcross / 4;
  for (const m of [50, 100, 200, 250, 500, 1000, 2000]) if (m >= target) return m;
  return 5000;
}

interface MapCanvasProps {
  lon: number;
  lat: number;
  headingDeg: number;
  /** The route ahead, lon and lat; read when the map redraws. */
  route: () => readonly (readonly [number, number])[];
  /** Metres from the left edge to the right. */
  spanM: number;
  overlay?: Overlay;
  /** A finer zoom to fetch the map's own detailed tiles at, drawn over the package's ground; none by default. */
  fineZoom?: number;
  className?: string;
}

/**
 * A map of the ground around the viewer, north up, drawn from the shipped package tiles onto a canvas: an
 * overlay when one is chosen, the viewer as an arrow pointing the way they look, the route ahead when riding,
 * the base, and a scale. Redrawn only when the view reports a new place or heading (a few times a second at
 * most), or an overlay tile arrives, so it costs nothing per frame.
 */
export function MapCanvas({ lon, lat, headingDeg, route, spanM, overlay = 'none', fineZoom, className }: MapCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const routeRef = useRef(route);
  // Bumped when an overlay tile or the geology arrives after the draw that asked for it.
  const [arrived, setArrived] = useState(0);
  useEffect(() => {
    routeRef.current = route;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const cssW = canvas.clientWidth || 200;
    const cssH = canvas.clientHeight || cssW;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Canvas pixels per map pixel of zoom 14.
    const scale = w / (spanM / metresPerPixel(lat, ZOOM));
    const cx = lonToPx(lon, ZOOM);
    const cy = latToPx(lat, ZOOM);
    const halfW = w / 2 / scale;
    const halfH = h / 2 / scale;
    const toCanvas = (plon: number, plat: number): [number, number] => [(lonToPx(plon, ZOOM) - cx) * scale + w / 2, (latToPx(plat, ZOOM) - cy) * scale + h / 2];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgb(122 74 48)';
    ctx.fillRect(0, 0, w, h);
    const x0 = Math.floor((cx - halfW) / 256);
    const x1 = Math.floor((cx + halfW) / 256);
    const y0 = Math.floor((cy - halfH) / 256);
    const y1 = Math.floor((cy + halfH) / 256);
    const pending: Promise<unknown>[] = [];
    // Jezero's floor is dark basalt: lifted well past the map's grade, so it reads at a glance this small.
    ctx.imageSmoothingQuality = 'high';
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const job = tileAt(tx, ty);
        pending.push(job);
        void job.then((t) => {
          if (!t || cancelled) return;
          try {
            ctx.filter = FILTER;
            ctx.drawImage(t.bitmap, t.sx, t.sy, t.size, t.size, (tx * 256 - cx) * scale + w / 2, (ty * 256 - cy) * scale + h / 2, 256 * scale + 0.5, 256 * scale + 0.5);
          } catch {
            // A tile evicted and closed meanwhile: the next redraw brings it back.
          }
        });
      }
    }

    // The map's own finer tiles, over the package's ground: those already here at once, the rest when they land.
    const drawFine = () => {
      if (!fineZoom) return;
      const k = 2 ** (fineZoom - ZOOM);
      const s = scale / k;
      const fx = cx * k;
      const fy = cy * k;
      const fx0 = Math.floor((fx - halfW * k) / 256);
      const fx1 = Math.floor((fx + halfW * k) / 256);
      const fy0 = Math.floor((fy - halfH * k) / 256);
      const fy1 = Math.floor((fy + halfH * k) / 256);
      const waiting: Promise<void>[] = [];
      // Lifted to read on a small screen held in daylight, as the map's own grade lifts it.
      ctx.filter = 'brightness(1.4) saturate(1.1) contrast(1.04)';
      // Nearest the middle first, so the ground under the viewer sharpens first.
      const order: [number, number][] = [];
      for (let ty = fy0; ty <= fy1; ty += 1) for (let tx = fx0; tx <= fx1; tx += 1) order.push([tx, ty]);
      const mx = fx / 256;
      const my = fy / 256;
      order.sort((a, b) => Math.hypot(a[0] + 0.5 - mx, a[1] + 0.5 - my) - Math.hypot(b[0] + 0.5 - mx, b[1] + 0.5 - my));
      // The base imagery, then the 25 cm HiRISE mosaic over it where it covers the ground (clear elsewhere), as the
      // map draws them.
      for (const kind of ['img', 'hd'] as const) {
        for (const [tx, ty] of order) {
          const entry = fineAt(kind, fineZoom, tx, ty);
          if (!entry.done) {
            waiting.push(entry.made);
            continue;
          }
          if (!entry.bitmap || entry.bitmap.width < 2) continue;
          try {
            ctx.drawImage(entry.bitmap, (tx * 256 - fx) * s + w / 2, (ty * 256 - fy) * s + h / 2, 256 * s + 0.5, 256 * s + 0.5);
          } catch {
            // Evicted meanwhile.
          }
        }
      }
      ctx.filter = 'none';
      if (waiting.length > 0) void Promise.race(waiting).then(() => !cancelled && setArrived((n) => n + 1));
    };

    const drawOverlay = async () => {
      if (overlay === 'none') return;
      ctx.filter = 'none';
      if (overlay === 'geology') {
        const shapes = await geologyShapes().catch(() => []);
        if (cancelled) return;
        const west = lon - (halfW * 360) / (256 * 2 ** ZOOM);
        const east = lon + (halfW * 360) / (256 * 2 ** ZOOM);
        const span = (halfH * 360) / (256 * 2 ** ZOOM);
        for (const s of shapes) {
          if (s.box[2] < west || s.box[0] > east || s.box[3] < lat - span || s.box[1] > lat + span) continue;
          const polys = s.feature.geometry.type === 'Polygon' ? [s.feature.geometry.coordinates] : s.feature.geometry.coordinates;
          ctx.beginPath();
          for (const poly of polys)
            for (const ring of poly)
              ring.forEach(([plon = 0, plat = 0], i) => {
                const [px, py] = toCanvas(plon, plat);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              });
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = s.colour;
          ctx.fill('evenodd');
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = '#1b1512';
          ctx.lineWidth = dpr;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        return;
      }
      const def = RASTER[overlay];
      const z = Math.max(def.minzoom, Math.min(def.maxzoom, ZOOM));
      const k = 2 ** (ZOOM - z);
      const ox0 = Math.floor((cx - halfW) / k / 256);
      const ox1 = Math.floor((cx + halfW) / k / 256);
      const oy0 = Math.floor((cy - halfH) / k / 256);
      const oy1 = Math.floor((cy + halfH) / k / 256);
      const waiting: Promise<void>[] = [];
      ctx.globalAlpha = def.opacity;
      for (let ty = oy0; ty <= oy1; ty += 1) {
        for (let tx = ox0; tx <= ox1; tx += 1) {
          const entry = overlayAt(overlay, z, tx, ty);
          if (!entry.done) {
            waiting.push(entry.made);
            continue;
          }
          if (!entry.bitmap) continue;
          try {
            ctx.drawImage(entry.bitmap, (tx * 256 * k - cx) * scale + w / 2, (ty * 256 * k - cy) * scale + h / 2, 256 * k * scale + 0.5, 256 * k * scale + 0.5);
          } catch {
            // Evicted meanwhile.
          }
        }
      }
      ctx.globalAlpha = 1;
      // What is still on its way redraws the map when it lands.
      if (waiting.length > 0) void Promise.all(waiting).then(() => !cancelled && setArrived((n) => n + 1));
    };

    // The overlay and the marks go on once the ground under them is in.
    void Promise.all(pending)
      .then(() => {
        if (!cancelled) drawFine();
      })
      .then(drawOverlay)
      .then(() => {
        if (cancelled) return;
        ctx.filter = 'none';
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
        if (bxp > -8 && bxp < w + 8 && byp > -8 && byp < h + 8) {
          const r = 5 * dpr;
          ctx.fillStyle = '#f2b632';
          ctx.strokeStyle = 'rgb(0 0 0 / 0.7)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.roundRect(bxp - r, byp - r, r * 2, r * 2, 2 * dpr);
          ctx.fill();
          ctx.stroke();
        }
        // The viewer: an arrow pointing the way they look, in a soft cone of view.
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate((headingDeg * Math.PI) / 180);
        const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 46 * dpr);
        cone.addColorStop(0, 'rgb(255 255 255 / 0.32)');
        cone.addColorStop(1, 'rgb(255 255 255 / 0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 46 * dpr, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
        ctx.closePath();
        ctx.fill();
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
        const metres = scaleFor(w * mPerPx);
        const len = metres / mPerPx;
        const bx = 8 * dpr;
        const by = h - 9 * dpr;
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
        ctx.fillText('N', w / 2, 13 * dpr);
        ctx.shadowBlur = 0;
      });
    return () => {
      cancelled = true;
    };
    // Redrawn at a new place or heading; the view reports both a few times a second at most.
  }, [lon, lat, headingDeg, spanM, overlay, fineZoom, arrived]);

  return <canvas ref={ref} className={cn('block size-full', className)} aria-hidden />;
}

interface MinimapProps {
  lon: number;
  lat: number;
  headingDeg: number;
  route: () => readonly (readonly [number, number])[];
  /** Back to the map over this spot. */
  onOpenMap: () => void;
  className?: string;
}

/** The small square map in the corner of Rover View. A click goes back to the map there. */
export function Minimap({ lon, lat, headingDeg, route, onOpenMap, className }: MinimapProps) {
  const overlay = useApp((s) => s.layers.overlay);
  return (
    <button
      type="button"
      onClick={onOpenMap}
      aria-label="Map of the surroundings, north up. Open the map here"
      title="Open the map here"
      className={cn('panel pointer-events-auto block overflow-hidden p-0 transition-shadow hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-primary', className)}
    >
      <MapCanvas lon={lon} lat={lat} headingDeg={headingDeg} route={route} spanM={1600} overlay={overlay} />
    </button>
  );
}
