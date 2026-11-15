import { useIsPhone } from '@/ui/hooks/useMediaQuery';
import { StationReadings } from './Stations';
import { useEffect, useState, type ReactNode } from 'react';
import { Binoculars, ClipboardList, Ellipsis, ExternalLink, House, Link2, MapPinPlus, Move, X, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { baseMoveBlocked, moveBaseTo } from '@/planner/moveBase';
import type { Base } from '@/planner/base';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { useApp } from '@/store';
import { getMap } from '@/map/instance';
import { containingFeature, nearby, resolvePlace, typeWord, type Neighbour, type PlaceView } from '@/data/places';
import { loadGeology } from '@/data/datasets';
import { finestZoomAt, groundAt, type GroundSample } from '@/data/dem';
import { getCoverage } from '@/data/coverage';
import { unitAt, type GeoUnit } from '@/engines/geology';
import { distanceM } from '@/lib/geo';
import { conditionsAt } from '@/engines/environment';
import { marsTime } from '@/engines/marsTime';
import { REGION, inBox } from '@/lib/constants';
import { fmtClock, fmtDeg, fmtDistance, fmtElevation, fmtLatLon, fmtNumber, fmtTemp } from '@/lib/format';
import { Button } from '@/ui/components/ui/button';
import { Row, Section } from '@/ui/shell/Section';
import { Photos } from './Photos';
import { NasaImages } from './NasaImages';

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'missing' };

/** The base as a place: opened from its pin on the map or from the plan. */
export const BASE_PLACE = 'base';

function fmtAgo(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function baseView(base: Base): PlaceView {
  const moved = base.movedBy && base.movedAt ? ` ${base.movedBy} moved it here ${fmtAgo(base.movedAt, Date.now())}.` : '';
  return {
    key: BASE_PLACE,
    kind: 'place',
    name: base.name,
    subtitle: 'The crew’s base, shared by everyone',
    lon: base.lon,
    lat: base.lat,
    summary: `Two habitats joined by a tunnel, a solar field, a radio mast and a landing pad, on level ground. Every crewed mission leaves from here and comes back here.${moved}`,
    photos: [],
    zoom: 15.5,
  };
}

function useResolved(key: string | null): Loaded<PlaceView> {
  const [result, setResult] = useState<{ key: string; value: PlaceView | null } | null>(null);
  const base = useApp((s) => s.base);
  useEffect(() => {
    if (!key || key === BASE_PLACE) return;
    let cancelled = false;
    void resolvePlace(key).then((value) => {
      if (!cancelled) setResult({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  if (key === BASE_PLACE) return { state: 'ready', value: baseView(base) };
  if (!key || result?.key !== key) return { state: 'loading' };
  return result.value ? { state: 'ready', value: result.value } : { state: 'missing' };
}

interface Context {
  ground: GroundSample | null;
  unit: GeoUnit | null;
  inside: { name: string; type: string } | null;
  near: Neighbour[];
}

/** Everything about the ground at a point that takes a fetch: height, rock unit, what is around. */
function usePlaceContext(view: PlaceView | null): Context | null {
  const [result, setResult] = useState<{ key: string; value: Context } | null>(null);
  const key = view?.key ?? null;
  const lon = view?.lon ?? 0;
  const lat = view?.lat ?? 0;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void Promise.all([
      groundAt(lon, lat).catch(() => null),
      loadGeology()
        .then((geo) => unitAt(geo, lon, lat))
        .catch(() => null),
      containingFeature(lon, lat),
      nearby(lon, lat, key),
    ]).then(([ground, unit, inside, near]) => {
      if (!cancelled) setResult({ key, value: { ground, unit, inside: inside && `feature:${inside.id}` !== key ? inside : null, near } });
    });
    return () => {
      cancelled = true;
    };
  }, [key, lon, lat]);
  return result && result.key === key ? result.value : null;
}

function elevationSource(zoom: number): string {
  if (zoom >= 14) return 'HiRISE terrain model, 1 m (Mars 2020 mission)';
  if (zoom >= 12) return 'CTX terrain model, 20 m (Mars 2020 mission)';
  if (zoom >= 6) return 'HRSC and MOLA blended terrain model, 200 m (USGS)';
  return 'MOLA global terrain model, 463 m';
}

function trekUrl(lon: number, lat: number, zoom: number): string {
  return `https://trek.nasa.gov/mars/#v=0.1&x=${lon.toFixed(5)}&y=${lat.toFixed(5)}&z=${Math.round(Math.max(1, Math.min(12, zoom - 2)))}&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=`;
}

/** For a bare point there is no written summary, so one is composed from what the data says. */
function pointSummary(ctx: Context | null): string {
  if (!ctx) return 'Reading the ground here…';
  const parts: string[] = [];
  const where = ctx.inside ? `This spot is in ${ctx.inside.name}, a ${typeWord(ctx.inside.type)}` : 'This spot has no name of its own';
  parts.push(ctx.unit ? `${where}, on ground the USGS geologic map calls the ${ctx.unit.name.toLowerCase()}.` : `${where}.`);
  const first = ctx.near[0];
  if (first) parts.push(`The nearest named place is ${first.name}, ${fmtDistance(first.distM)} to the ${first.direction}.`);
  return parts.join(' ');
}

function Glance({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="figure mt-0.5 text-[21px] leading-tight font-medium tracking-[-0.01em] [font-stretch:92%]">
        {value}
        {unit ? <span className="ml-1 text-[13px] font-normal text-muted-foreground">{unit}</span> : null}
      </dd>
    </div>
  );
}

function ActionButton({ icon, children, ...props }: { icon: ReactNode; children: ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[15px] [&_svg]:text-muted-foreground"
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

const split = (text: string): [string, string] => {
  const m = /^(-?[\d.,\u2212]+)\s*(.*)$/.exec(text.replaceAll('\u00a0', ' '));
  return m ? [m[1] ?? text, m[2] ?? ''] : [text, ''];
};

export function PlaceCard() {
  const placeId = useApp((s) => s.placeId);
  const phone = useIsPhone();
  const openPlace = useApp((s) => s.openPlace);
  const scenario = useApp((s) => s.scenario);
  // Conditions are shown to the minute; no need to re-render every second.
  const minute = useApp((s) => Math.floor(s.utcMs / 60_000));
  const resolved = useResolved(placeId);
  const view = resolved.state === 'ready' ? resolved.value : null;
  const ctx = usePlaceContext(view);

  if (!placeId) return null;

  if (resolved.state !== 'ready') {
    return (
      <section className="panel p-4" aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {resolved.state === 'loading' ? 'Loading this place…' : 'This place could not be found. It may have been removed from the data.'}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={() => openPlace(null)}
            className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </section>
    );
  }

  const v = resolved.value;
  const utcMs = minute * 60_000;
  const ground = ctx?.ground ?? null;
  const cond = ground ? conditionsAt(v.lat, v.lon, ground.elev, utcMs, scenario) : null;
  const time = marsTime(utcMs, v.lon);
  const inRegion = inBox(REGION, v.lon, v.lat);
  // Nothing is added to a plan that is being flown.
  const planOpen = inRegion && useApp.getState().world?.run?.status !== 'running';
  const base = useApp.getState().base;
  const isBase = v.key === BASE_PLACE;
  const moveBlocked = baseMoveBlocked();
  const cov = getCoverage();
  const sourceZoom = cov ? finestZoomAt(cov, v.lon, v.lat) : 0;
  const [elevValue, elevUnit] = ground ? split(fmtElevation(ground.elev)) : ['…', ''];
  const [tempValue, tempUnit] = cond ? split(fmtTemp(cond.tempC)) : ['…', ''];

  const asWaypoint = { lon: v.lon, lat: v.lat, name: v.kind === 'point' ? undefined : v.name, ...(v.kind === 'point' ? {} : { placeId: v.key }) };

  // The stop opens in the plan with its name field ready.
  const routeHere = () => useApp.getState().addStop(asWaypoint);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('Link copied', { description: 'It opens the map on this place.' });
    } catch {
      toast('Could not copy the link', { description: 'Copy the address from the browser bar instead.' });
    }
  };

  return (
    <article className="panel flex min-h-0 flex-col overflow-hidden" aria-label={v.name}>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {phone ? null : <Photos photos={v.photos} name={v.name} />}

        <header className="relative px-4 pt-4 pr-12 max-md:pt-1.5">
          <h2 className="text-[19px] leading-snug font-semibold tracking-[-0.01em]">{v.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{v.subtitle}</p>
          <button
            type="button"
            aria-label={`Close ${v.name}`}
            onClick={() => openPlace(null)}
            className="absolute top-3 right-2.5 inline-flex size-9 items-center max-md:top-0.5 pointer-coarse:size-11 justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <p className="px-4 pt-3 text-sm leading-relaxed">{v.kind === 'point' ? pointSummary(ctx) : v.summary}</p>
        {/* On a phone the sheet opens half way: the name and the summary come before the photos. */}
        {phone && v.photos.length > 0 ? (
          <div className="mt-3">
            <Photos photos={v.photos} name={v.name} />
          </div>
        ) : null}
        {v.detail ? <p className="px-4 pt-2 text-[13px] leading-relaxed text-muted-foreground">{v.detail}</p> : null}
        {v.kind === 'point' || isBase ? null : <NasaImages name={v.name} />}

        <div className="flex flex-wrap gap-1.5 px-4 pt-4">
          {isBase ? (
            <Button onClick={() => useApp.getState().openPlanner(true)} className="h-9 px-3.5 text-[13px] font-semibold">
              <ClipboardList aria-hidden />
              Plan a mission
            </Button>
          ) : (
            <>
              <Button onClick={routeHere} disabled={!planOpen} className="h-9 px-3.5 text-[13px] font-semibold">
                <MapPinPlus aria-hidden />
                Add to the route
              </Button>
            </>
          )}
          <ActionButton icon={<Binoculars aria-hidden />} disabled={!inRegion} onClick={() => useApp.getState().openVisor({ lon: v.lon, lat: v.lat })}>
            Rover View
          </ActionButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ActionButton icon={<Ellipsis aria-hidden />} aria-label="More actions">
                <span className="sr-only">More</span>
              </ActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onSelect={() => getMap()?.flyTo({ center: [v.lon, v.lat], zoom: Math.min(16, Math.max(v.zoom, (getMap()?.getZoom() ?? 0) + 1.5)), duration: 1400 })}
              >
                <ZoomIn aria-hidden />
                Zoom in
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void share()}>
                <Link2 aria-hidden />
                Copy a link
              </DropdownMenuItem>
              {inRegion ? <DropdownMenuSeparator /> : null}
              {isBase ? (
                <DropdownMenuItem disabled={moveBlocked !== null} onSelect={() => useApp.getState().setPicking('base')}>
                  <Move aria-hidden />
                  Move the base…
                </DropdownMenuItem>
              ) : inRegion ? (
                <DropdownMenuItem disabled={moveBlocked !== null} onSelect={() => void moveBaseTo(v.lon, v.lat)}>
                  <House aria-hidden />
                  Move the base here…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isBase && moveBlocked ? <p className="px-4 pt-2 text-xs leading-relaxed text-muted-foreground">{moveBlocked}</p> : null}
        {!inRegion ? (
          <p className="px-4 pt-2 text-xs leading-relaxed text-muted-foreground">
            Outside the mapped region, {fmtDistance(distanceM(base.lon, base.lat, v.lon, v.lat))} from {base.name}. You can look from orbit; routes, a base and Rover View need
            the terrain of Jezero and Nili Fossae.
          </p>
        ) : null}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t px-4 py-4">
          <Glance label="Elevation" value={elevValue} unit={elevUnit} />
          <Glance label="Slope here" value={ground ? fmtDeg(ground.slopeDeg, ground.slopeDeg < 10 ? 1 : 0) : '…'} />
          <Glance label="Temperature now" value={tempValue} unit={tempUnit} />
          <Glance label="Local time" value={fmtClock(time.ltstH)} unit="LTST" />
        </dl>

        <Section id="place-geology" title="Geology" hint={ctx?.unit ? ctx.unit.name : 'What the ground is made of'}>
          {ctx?.unit ? (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-1 size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/20" style={{ background: ctx.unit.colour }} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{ctx.unit.name}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{ctx.unit.what}</p>
                </div>
              </div>
              <div className="mt-3">
                <Row label="Map unit" value={ctx.unit.code} />
                <Row label="Period" value={ctx.unit.period} />
                <Row label="Age" value={ctx.unit.age} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-faint">
                From the USGS global geologic map of Mars (Tanaka and others, 2014). It is drawn for the whole planet, so
                boundaries are good to a few kilometres.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">{ctx ? 'The geologic map does not cover this spot.' : 'Reading the geologic map…'}</p>
          )}
        </Section>

        <Section id="place-conditions" title="Conditions now" hint="Modelled for this spot, and what the rovers measured">
          {cond && ground ? (
            <>
              <Row label="Air temperature" value={fmtTemp(cond.tempC)} />
              <Row label="Air pressure" value={`${fmtNumber(cond.pressurePa)} Pa`} />
              <Row label="Dust in the sky" value={`tau ${fmtNumber(cond.tau, 2)}`} />
              <Row label="Visibility" value={`${fmtNumber(cond.visibilityKm)} km`} />
              <Row label="Radiation dose" value={`${fmtNumber(cond.doseMSvPerSol, 2)} mSv per sol`} />
              <Row label="Sun above the horizon" value={cond.sunElevDeg > 0 ? fmtDeg(cond.sunElevDeg) : 'Night'} />
              <Row label="Season" value={`Ls ${fmtNumber(time.lsDeg)}°`} />
              <p className="mt-3 text-xs leading-relaxed text-faint">
                These numbers are modelled from the season, the hour and the height of the ground, not measured here. How it
                works explains each model and its limits.
              </p>
              <StationReadings />
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Working out the conditions…</p>
          )}
        </Section>

        <Section id="place-data" title="Data and sources" hint="Where these numbers come from">
          <Row label="Coordinates" value={fmtLatLon(v.lat, v.lon)} />
          <Row label="Elevation from" value={<span className="font-sans font-normal">{elevationSource(sourceZoom)}</span>} />
          <Row label="Heights measured from" value={<span className="font-sans font-normal">the Mars areoid</span>} />
          {v.sol !== undefined ? <Row label="Rover sol" value={fmtNumber(v.sol)} /> : null}
          <a
            href={trekUrl(v.lon, v.lat, v.zoom)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
          >
            Open this spot in NASA Mars Trek
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Section>

        <Section id="place-nearby" title="Nearby" hint={ctx?.near.length ? `${ctx.near.length} named places within 40 km` : 'Named places around here'}>
          {ctx && ctx.near.length > 0 ? (
            <ul className="-mx-2">
              {ctx.near.map((n) => (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => {
                      openPlace(n.key);
                      getMap()?.flyTo({ center: [n.lon, n.lat], duration: 1200 });
                    }}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{n.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{n.hint}</span>
                    </span>
                    <span className="figure shrink-0 text-xs text-muted-foreground">
                      {fmtDistance(n.distM)} {n.direction}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{ctx ? 'Nothing with a name within 40 km.' : 'Looking around…'}</p>
          )}
        </Section>
      </div>
    </article>
  );
}
