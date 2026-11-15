import { Bot, Car, Caravan, Eye, Footprints, Helicopter, ZoomIn, ZoomOut } from 'lucide-react';
import type { VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import type { RoamView } from '@/visor';
import { cn } from '@/lib/cn';

const CHOICES: readonly { id: VehicleId; icon: typeof Footprints; label: string }[] = [
  { id: 'foot', icon: Footprints, label: 'Walk' },
  { id: 'pressRover', icon: Caravan, label: VEHICLES.pressRover.name },
  { id: 'openRover', icon: Car, label: VEHICLES.openRover.name },
  { id: 'robotRover', icon: Bot, label: 'Perseverance' },
  { id: 'heli', icon: Helicopter, label: 'Ingenuity' },
];

const VIEWS: readonly { id: RoamView; icon: typeof Eye; label: string }[] = [
  { id: 'eyes', icon: Eye, label: 'Eyes' },
  { id: 'close', icon: ZoomIn, label: 'Close' },
  { id: 'far', icon: ZoomOut, label: 'Far' },
];

const ITEM = 'inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-11';

/** On your own in Rover View: what you move as, and where the camera stands. */
export function RoamBar({ vehicle, view, onChange }: { vehicle: VehicleId; view: RoamView; onChange: (vehicle: VehicleId, view: RoamView) => void }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div role="radiogroup" aria-label="Move as" className="panel flex gap-0.5 p-0.5">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={vehicle === c.id}
            title={c.id === 'foot' ? 'Walk in a suit' : `Drive the ${c.label}`}
            // Taking a vehicle shows it from close behind; walking goes back to your own eyes.
            onClick={() => onChange(c.id, c.id === 'foot' ? 'eyes' : view === 'eyes' ? 'close' : view)}
            className={cn(ITEM, vehicle === c.id ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}
          >
            <c.icon className="size-4" aria-hidden />
            <span className="max-lg:sr-only">{c.label}</span>
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Camera" className="panel flex gap-0.5 p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={view === v.id}
            onClick={() => onChange(vehicle, v.id)}
            className={cn(ITEM, view === v.id ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}
          >
            <v.icon className="size-4" aria-hidden />
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
