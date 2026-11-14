import { nasaUrl } from '@/lib/nasa';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker } from 'maplibre-gl';
import { Binoculars, MapPin } from 'lucide-react';
import { loadPlaces, loadSamples, loadTraverse, type Place, type SampleCore, type Traverse } from '@/data/datasets';
import { getMap } from '@/map/instance';
import { useApp } from '@/store';
import { distanceM } from '@/lib/geo';
import { fmtNumber } from '@/lib/format';
import { Section } from '@/ui/shell/Section';

interface RawFrame {
  src: string;
  full: string;
  camera: string;
}

/** Up to four Navcam frames the rover took on a sol, asked of NASA’s raw-images feed when wanted. */
async function framesOn(sol: number, signal: AbortSignal): Promise<RawFrame[]> {
  const q = new URLSearchParams({
    feed: 'raw_images',
    category: 'mars2020',
    feedtype: 'json',
    ver: '1.2',
    num: '24',
    page: '0',
    order: 'sol asc',
    search: '|NAVCAM_LEFT',
    condition_2: `${sol}:sol:gte`,
    condition_3: `${sol}:sol:lte`,
  });
  const res = await fetch(`https://mars.nasa.gov/rss/api/?${q.toString()}`, { signal });
  if (!res.ok) throw new Error(`The feed answered ${res.status}`);
  const body = (await res.json()) as { images?: { image_files?: { medium?: string; small?: string; large?: string }; sample_type?: string; camera?: { instrument?: string } }[] };
  const frames: RawFrame[] = [];
  for (const image of body.images ?? []) {
    if (image.sample_type !== 'Full') continue;
    const src = nasaUrl(image.image_files?.medium);
    if (!src) continue;
    frames.push({ src, full: nasaUrl(image.image_files?.large) ?? src, camera: 'Navcam' });
  }
  // Spread the picks across the sol rather than taking four frames of the same minute.
  const step = Math.max(1, Math.floor(frames.length / 4));
  return frames.filter((_, i) => i % step === 0).slice(0, 4);
}

function FollowPerseverance({ traverse, places }: { traverse: Traverse; places: Place[] }) {
  const stops = traverse.waypoints;
  const [index, setIndex] = useState(stops.length - 1);
  const [frames, setFrames] = useState<{ sol: number; state: 'loading' | 'ready' | 'failed'; list: RawFrame[] } | null>(null);
  const marker = useRef<Marker | null>(null);
  const stop = stops[Math.min(index, stops.length - 1)];

  useEffect(() => {
    const map = getMap();
    if (!map || !stop) return;
    if (!marker.current) {
      const el = document.createElement('div');
      el.className = 'rover-dot';
      marker.current = new Marker({ element: el, anchor: 'center' });
    }
    marker.current.setLngLat([stop.lon, stop.lat]).addTo(map);
  }, [stop]);
  useEffect(
    () => () => {
      marker.current?.remove();
      marker.current = null;
    },
    [],
  );

  const nearest = useMemo(() => {
    if (!stop) return null;
    let best: { name: string; d: number } | null = null;
    for (const p of places) {
      if (p.kind === 'sample') continue;
      const d = distanceM(stop.lon, stop.lat, p.lon, p.lat);
      if (d < 400 && (!best || d < best.d)) best = { name: p.name, d };
    }
    return best;
  }, [stop, places]);

  if (!stop) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];

  const showFrames = () => {
    const sol = stop.sol;
    setFrames({ sol, state: 'loading', list: [] });
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    framesOn(sol, abort.signal)
      .then((list) => setFrames({ sol, state: 'ready', list }))
      .catch(() => setFrames({ sol, state: 'failed', list: [] }))
      .finally(() => window.clearTimeout(timer));
  };

  return (
    <div className="px-4 pt-3 pb-4">
      <h3 className="text-[13px] font-semibold">Follow Perseverance</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        The rover has driven {fmtNumber(last?.distKm ?? 0, 1)} km since it landed in February 2021. Drag the slider to see where it was on any sol.
      </p>
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        value={index}
        aria-label="Sol"
        aria-valuetext={`Sol ${stop.sol}`}
        onChange={(e) => {
          setIndex(Number(e.target.value));
          setFrames(null);
        }}
        className="mt-3 w-full accent-[var(--primary)]"
      />
      <div className="figure flex justify-between text-[11px] text-faint">
        <span>Sol {first?.sol}</span>
        <span>Sol {last?.sol}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Sol</dt>
          <dd className="figure text-[19px] leading-tight font-medium">{stop.sol}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Driven by then</dt>
          <dd className="figure text-[19px] leading-tight font-medium">
            {fmtNumber(stop.distKm, 2)}
            <span className="ml-1 text-[13px] font-normal text-muted-foreground">km</span>
          </dd>
        </div>
      </dl>
      <p className="mt-2 min-h-5 text-[13px] text-muted-foreground">{nearest ? `Near ${nearest.name}.` : ''}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => getMap()?.flyTo({ center: [stop.lon, stop.lat], zoom: Math.max(14, getMap()?.getZoom() ?? 14), duration: 1600 })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium hover:bg-secondary"
        >
          <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
          Go there
        </button>
        <button
          type="button"
          onClick={() => useApp.getState().openVisor({ lon: stop.lon, lat: stop.lat })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium hover:bg-secondary"
        >
          <Binoculars className="size-3.5 text-muted-foreground" aria-hidden />
          {index === stops.length - 1 ? 'Stand beside the rover' : 'Stand there'}
        </button>
        <button type="button" onClick={showFrames} className="inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] font-medium hover:bg-secondary">
          What it saw that sol
        </button>
      </div>
      {frames && frames.sol === stop.sol ? (
        <div className="mt-3" aria-live="polite">
          {frames.state === 'loading' ? <p className="text-xs text-muted-foreground">Asking NASA for the rover’s photos from sol {frames.sol}…</p> : null}
          {frames.state === 'failed' ? <p className="text-xs text-muted-foreground">NASA’s photo feed did not answer. The rest of the app works without it.</p> : null}
          {frames.state === 'ready' && frames.list.length === 0 ? <p className="text-xs text-muted-foreground">No navigation camera photos are listed for sol {frames.sol}.</p> : null}
          {frames.list.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {frames.list.map((f) => (
                  <a key={f.src} href={f.full} target="_blank" rel="noreferrer" className="block overflow-hidden rounded bg-sunken">
                    <img src={f.src} alt={`Navigation camera photo, sol ${frames.sol}`} loading="lazy" decoding="async" width={320} height={240} className="aspect-[4/3] w-full object-cover" />
                  </a>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-faint">Raw navigation camera frames, sol {frames.sol}. NASA/JPL-Caltech.</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DiscoverPanel() {
  const [data, setData] = useState<{ traverse: Traverse | null; places: Place[]; samples: SampleCore[] } | null>(null);
  const openPlace = useApp((s) => s.openPlace);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadTraverse().catch(() => null), loadPlaces().catch(() => [] as Place[]), loadSamples().catch(() => [] as SampleCore[])]).then(
      ([traverse, places, samples]) => {
        if (!cancelled) setData({ traverse, places, samples });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return <p className="px-4 py-5 text-sm text-muted-foreground">Loading what Perseverance found…</p>;
  const sites = data.places.filter((p) => p.kind !== 'sample');
  const go = (key: string, lon: number, lat: number) => {
    openPlace(key);
    getMap()?.flyTo({ center: [lon, lat], zoom: Math.max(14, getMap()?.getZoom() ?? 14), duration: 1800 });
  };

  return (
    <div>
      {data.traverse ? <FollowPerseverance traverse={data.traverse} places={data.places} /> : null}

      <div className="border-t px-4 pt-4 pb-2">
        <h3 className="text-[13px] font-semibold">Places the rover studied</h3>
        <ul className="-mx-2 mt-2">
          {sites.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => go(`place:${p.id}`, p.lon, p.lat)} className="flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-secondary">
                {p.photos[0] ? (
                  <img src={p.photos[0].src} alt="" loading="lazy" decoding="async" width={44} height={44} className="size-11 shrink-0 rounded object-cover" />
                ) : (
                  <span className="size-11 shrink-0 rounded bg-sunken" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.sol !== undefined ? `Sol ${p.sol}` : 'Perseverance site'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Section id="discover-samples" title="Samples collected" hint={`${data.samples.length} tubes of rock, soil and air`}>
        <ul className="-mx-2">
          {data.samples.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => go(`sample:${s.id}`, s.lon, s.lat)} className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.rock}</span>
                </span>
                <span className="figure shrink-0 text-xs text-muted-foreground">Sol {s.sol}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
