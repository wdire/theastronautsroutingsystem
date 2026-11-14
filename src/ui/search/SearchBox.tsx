import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Camera, FlaskConical, MapPin, Mountain, Rocket, Search, X } from 'lucide-react';
import { loadMarsNames, loadNames, loadPlaces, loadSamples, loadSites } from '@/data/datasets';
import { inBox, REGION } from '@/lib/constants';
import { searchItems, type SearchItem } from '@/data/search';
import { getMap } from '@/map/instance';
import { useApp } from '@/store';
import { cn } from '@/lib/cn';

const KIND_ICON = { place: Camera, sample: FlaskConical, feature: Mountain, site: Rocket, coordinates: MapPin } as const;

function featureZoom(diameterKm: number): number {
  if (!(diameterKm > 0)) return 11;
  return Math.max(4, Math.min(13, 15.2 - Math.log2(diameterKm * 2.2)));
}

/** Feature types people search for by name. */
const LANDMARK = /^(Mons|Montes|Planitia|Planum|Vallis|Valles|Crater|Chasma|Tholus|Patera)$/;

function sizeHint(type: string, km: number): string {
  return km > 0 ? `${type}, ${km >= 10 ? Math.round(km) : km.toFixed(1)} km across` : type;
}

/**
 * Builds the search list from whatever data has loaded; a file that fails only leaves its entries out. The
 * planet's other names come in once the visitor starts typing (`wide`), marked when they lie outside the region.
 */
function useSearchIndex(wide: boolean): SearchItem[] {
  const [items, setItems] = useState<SearchItem[]>([]);
  useEffect(() => {
    if (!wide) return;
    let cancelled = false;
    loadMarsNames()
      .then((names) => {
        if (cancelled) return;
        setItems((prev) => {
          const have = new Set(prev.map((i) => i.key));
          const more: SearchItem[] = [];
          for (const n of names) {
            const key = `feature:${n.id}`;
            if (have.has(key)) continue;
            const inside = inBox(REGION, n.lon, n.lat);
            more.push({
              key,
              kind: 'feature',
              name: n.name,
              hint: inside ? sizeHint(n.type, n.diameterKm) : `${sizeHint(n.type, n.diameterKm)} · outside the mapped region`,
              lon: n.lon,
              lat: n.lat,
              zoom: featureZoom(n.diameterKm),
              // Below the region's own names when they tie, so a search near home finds home first; the planet's
              // landmarks (mountains, plains, canyons, craters) above scarps and spots of the same name.
              weight: n.diameterKm * (inside ? 1 : 0.5) * (LANDMARK.test(n.type) ? 4 : 1),
            });
          }
          return prev.concat(more);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wide]);
  useEffect(() => {
    let cancelled = false;
    const add = (more: SearchItem[]) => {
      if (!cancelled && more.length)
        setItems((prev) => {
          const have = new Set(prev.map((i) => i.key));
          return prev.concat(more.filter((m) => !have.has(m.key)));
        });
    };
    loadPlaces()
      .then((places) =>
        add(
          places.filter((p) => p.kind !== 'sample').map((p) => ({
            key: `place:${p.id}`,
            kind: p.kind === 'site' ? 'site' : 'place',
            name: p.name,
            hint: p.sol !== undefined ? `Visited by Perseverance, sol ${p.sol}` : 'Perseverance site',
            lon: p.lon,
            lat: p.lat,
            zoom: 14.5,
            weight: 1000,
          })),
        ),
      )
      .catch(() => undefined);
    loadSamples()
      .then((samples) =>
        add(
          samples.map((s) => ({
            key: `sample:${s.id}`,
            kind: 'sample',
            name: s.name,
            hint: `Rock sample, sol ${s.sol}`,
            lon: s.lon,
            lat: s.lat,
            zoom: 15,
            weight: 500,
          })),
        ),
      )
      .catch(() => undefined);
    loadNames()
      .then((names) =>
        add(
          names.map((n) => ({
            key: `feature:${n.id}`,
            kind: 'feature',
            name: n.name,
            hint: sizeHint(n.type, n.diameterKm),
            lon: n.lon,
            lat: n.lat,
            zoom: featureZoom(n.diameterKm),
            weight: n.diameterKm,
          })),
        ),
      )
      .catch(() => undefined);
    loadSites()
      .then((sites) =>
        add(
          sites.map((s) => ({
            key: `site:${s.id}`,
            kind: 'site',
            name: s.name,
            hint: 'Landing site',
            lon: s.lon,
            lat: s.lat,
            zoom: 9,
            weight: 800,
          })),
        ),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return items;
}

/** `leading` is the control at the left end of the box: the main menu. */
export function SearchBox({ leading }: { leading: ReactNode }) {
  const [text, setText] = useState('');
  const index = useSearchIndex(text.trim().length > 0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const openPlace = useApp((s) => s.openPlace);

  const results = useMemo(() => searchItems(index, text), [index, text]);
  const showList = open && text.trim().length > 0;

  // "/" focuses the search from anywhere outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (useApp.getState().mode !== 'map') return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (item: SearchItem) => {
    setText(item.kind === 'coordinates' ? '' : item.name);
    setOpen(false);
    inputRef.current?.blur();
    const map = getMap();
    if (map) {
      const far = Math.abs(map.getCenter().lng - item.lon) > 3 || Math.abs(map.getCenter().lat - item.lat) > 3;
      // Far away, frame the whole feature; nearby, keep at least the zoom the visitor was at.
      map.flyTo({ center: [item.lon, item.lat], zoom: far ? item.zoom : Math.max(item.zoom, Math.min(map.getZoom(), 15)), duration: far ? 3200 : 1600 });
    }
    openPlace(item.kind === 'coordinates' ? `@${item.lat.toFixed(5)},${item.lon.toFixed(5)}` : item.key);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="panel flex h-12 items-center gap-0.5 pr-1.5 pl-1 focus-within:border-ring">
        {leading}
        <input
          ref={inputRef}
          type="text"
          name="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label="Search places or coordinates"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          placeholder="Search places or coordinates…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (results.length ? (a + 1) % results.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
            } else if (e.key === 'Enter') {
              const item = results[active];
              if (item) choose(item);
            } else if (e.key === 'Escape') {
              if (showList) setOpen(false);
              else if (text) setText('');
              else inputRef.current?.blur();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {text ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('');
              inputRef.current?.focus();
            }}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : (
          <Search className="mr-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </div>

      {showList ? (
        <ul id={listId} role="listbox" aria-label="Search results" className="panel absolute inset-x-0 top-[calc(100%+6px)] z-10 overflow-hidden py-1">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              Nothing by that name. Try a crater, a rover site, or coordinates such as 18.44, 77.45.
            </li>
          ) : (
            results.map((item, i) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li
                  key={item.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                  className={cn('flex cursor-pointer items-center gap-3 px-3.5 py-2', i === active && 'bg-secondary')}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
