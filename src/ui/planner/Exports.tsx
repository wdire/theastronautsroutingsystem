import { Download, Ellipsis, Printer } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { missionById } from '@/engines/missions';
import { missionCardHtml, toGeoJson, toGpx, type ExportInput } from '@/engines/export';
import type { RouteAlternative } from '@/engines/types';
import { useApp } from '@/store';

function exportInput(alt: RouteAlternative, hasBudget: boolean): ExportInput {
  const s = useApp.getState();
  return {
    name: (s.missionId ? missionById(s.missionId)?.title : undefined) ?? 'Areo mission',
    plan: s.plan,
    path: [...alt.path],
    stopIndices: [...alt.stopIndices],
    trip: hasBudget ? alt.trip : null,
    // The departure the budget was worked out for, which may be a later morning than now.
    departUtcMs: s.route.status === 'ready' ? s.route.departUtcMs : (s.departUtcMs ?? s.utcMs),
  };
}

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // The browser has taken the file by the next task.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints the cuff card through a hidden frame, so the app itself is not what gets printed. */
function printCard(html: string): void {
  const frame = document.createElement('iframe');
  frame.title = 'Cuff card';
  frame.setAttribute('aria-hidden', 'true');
  // No scripts run in the card; the page only needs to reach the frame to ask it to print.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      toast('The cuff card could not be printed', { description: 'This browser blocked the print window.' });
    }
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.append(frame);
}

/** Take the route away, behind a "More" button: to a sleeve as a printed card, or to a GPS unit or a GIS as a file. */
export function Exports({ alt, hasBudget }: { alt: RouteAlternative; hasBudget: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More: print or download the route"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors hover:bg-secondary data-[state=open]:bg-secondary pointer-coarse:h-11"
        >
          <Ellipsis className="size-4 text-muted-foreground" aria-hidden />
          More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => printCard(missionCardHtml(exportInput(alt, hasBudget)))}>
          <Printer aria-hidden />
          Print a cuff card
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Download the route</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => download('areo-route.gpx', 'application/gpx+xml', toGpx(exportInput(alt, hasBudget)))}>
          <Download aria-hidden />
          GPX, for a GPS unit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download('areo-route.geojson', 'application/geo+json', JSON.stringify(toGeoJson(exportInput(alt, hasBudget)), null, 1))}>
          <Download aria-hidden />
          GeoJSON, for a GIS
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
