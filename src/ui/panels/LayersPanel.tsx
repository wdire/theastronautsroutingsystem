import { useEffect, useState } from 'react';
import { loadGeology } from '@/data/datasets';
import type { GeoUnit } from '@/engines/geology';
import { VEHICLES } from '@/engines/vehicles';
import { useApp, type Overlay } from '@/store';
import { Switch } from '@/ui/components/ui/switch';
import { fmtDeg } from '@/lib/format';
import { cn } from '@/lib/cn';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

const OVERLAYS: readonly { id: Overlay; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Just the ground as the cameras see it.' },
  { id: 'geology', label: 'Geologic map', hint: 'What kind of rock is where, and how old. USGS, whole planet.' },
  { id: 'olivine', label: 'Olivine and pyroxene', hint: 'Volcanic minerals seen from orbit by CRISM.' },
  { id: 'carbonate', label: 'Carbonate', hint: 'Minerals that form in water, seen from orbit by CRISM.' },
  { id: 'slope', label: 'Slope', hint: 'Where the ground is too steep for the chosen vehicle.' },
];

function Swatch({ colour }: { colour: string }) {
  return <span className="mt-0.5 size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/25" style={{ background: colour }} aria-hidden />;
}

function Legend({ overlay }: { overlay: Overlay }) {
  const [units, setUnits] = useState<GeoUnit[] | null>(null);
  const vehicle = useApp((s) => VEHICLES[s.plan.vehicle]);
  useEffect(() => {
    if (overlay !== 'geology' || units) return;
    let cancelled = false;
    loadGeology()
      .then((geo) => {
        if (!cancelled) setUnits(geo.units);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [overlay, units]);

  if (overlay === 'geology') {
    return (
      <div className="mt-2 rounded-md border p-3">
        {units ? (
          <ul className="flex flex-col gap-2">
            {units.map((u) => (
              <li key={u.code} className="flex items-start gap-2.5 text-xs leading-snug">
                <Swatch colour={u.colour} />
                <span>
                  <span className="font-medium text-foreground">{u.name}</span>
                  <span className="text-muted-foreground"> {u.age}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Loading the map units…</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-faint">Tanaka and others, 2014 (USGS SIM 3292). Drawn for the whole planet: boundaries are good to a few kilometres.</p>
      </div>
    );
  }
  if (overlay === 'olivine' || overlay === 'carbonate') {
    const items =
      overlay === 'olivine'
        ? [
            ['#d8443c', 'Red: olivine'],
            ['#4fae5a', 'Green: pyroxene low in calcium'],
            ['#4a78d0', 'Blue: pyroxene rich in calcium'],
          ]
        : [['#f2e9b0', 'Yellow to white: magnesium carbonate']];
    return (
      <div className="mt-2 rounded-md border p-3">
        <ul className="flex flex-col gap-2">
          {items.map(([colour, text]) => (
            <li key={text} className="flex items-start gap-2.5 text-xs leading-snug">
              <Swatch colour={colour ?? '#888'} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          CRISM on Mars Reconnaissance Orbiter, 21 targeted images over Jezero. Each image has its own colour stretch, so compare colours within one image,
          not between images. Zoom in to the crater to see them.
        </p>
      </div>
    );
  }
  if (overlay === 'slope') {
    return (
      <div className="mt-2 rounded-md border p-3">
        <ul className="flex flex-col gap-2 text-xs leading-snug">
          <li className="flex items-start gap-2.5">
            <Swatch colour="#e9be5a" />
            <span>Amber: harder going, above {fmtDeg(vehicle.comfortSlopeDeg)}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Swatch colour="#e23e2c" />
            <span>
              Red: too steep, above {fmtDeg(vehicle.blockSlopeDeg)}. Routes do not cross it.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          For: {vehicle.name.toLowerCase()}. Worked out from the terrain model under the map; change the vehicle in the mission plan and this changes too.
        </p>
      </div>
    );
  }
  return null;
}

export function LayersPanel() {
  const layers = useApp((s) => s.layers);
  const setLayers = useApp((s) => s.setLayers);
  return (
    <div className="px-4 pb-4">
      <h3 className="pt-3 pb-1 text-xs font-medium text-muted-foreground">On the map</h3>
      <Toggle label="Place names" hint="Craters, valleys and plains named by the IAU." checked={layers.names} onChange={(names) => setLayers({ names })} />
      <Toggle label="Rover sites and samples" hint="Places Perseverance studied and where it took its samples." checked={layers.rover} onChange={(rover) => setLayers({ rover })} />
      <Toggle label="Perseverance’s drive" hint="The rover’s track since landing in 2021." checked={layers.traverse} onChange={(traverse) => setLayers({ traverse })} />

      <h3 className="mt-3 border-t pt-4 pb-2 text-xs font-medium text-muted-foreground">Overlay</h3>
      <div role="radiogroup" aria-label="Overlay" className="flex flex-col gap-1">
        {OVERLAYS.map((o) => {
          const checked = layers.overlay === o.id;
          return (
            <div key={o.id}>
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setLayers({ overlay: o.id })}
                className={cn('flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors', checked ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-muted')}
              >
                <span className={cn('mt-1 size-3 shrink-0 rounded-full border-2', checked ? 'border-primary bg-primary' : 'border-muted-foreground')} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{o.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{o.hint}</span>
                </span>
              </button>
              {checked ? <Legend overlay={o.id} /> : null}
            </div>
          );
        })}
      </div>

      <h3 className="mt-3 border-t pt-4 pb-1 text-xs font-medium text-muted-foreground">Light</h3>
      <Toggle
        label="Follow the real sun"
        hint="Light the map by the Sun at Jezero for the time on the Mars clock: long shadows at dawn, dark at night. Off: lit as at mid-morning, so it always reads."
        checked={!layers.daylight}
        onChange={(sun) => setLayers({ daylight: !sun })}
      />
    </div>
  );
}
