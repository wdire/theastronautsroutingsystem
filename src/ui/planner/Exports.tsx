import { Download, Printer } from 'lucide-react';
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

const BUTTON = 'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors hover:bg-secondary pointer-coarse:h-11';

/** Take the route away: to a GPS unit or a GIS as a file, or to a sleeve as a printed card. */
export function Exports({ alt, hasBudget }: { alt: RouteAlternative; hasBudget: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <button type="button" className={BUTTON} onClick={() => printCard(missionCardHtml(exportInput(alt, hasBudget)))}>
        <Printer className="size-3.5 text-muted-foreground" aria-hidden />
        Print cuff card
      </button>
      <button type="button" className={BUTTON} onClick={() => download('areo-route.gpx', 'application/gpx+xml', toGpx(exportInput(alt, hasBudget)))}>
        <Download className="size-3.5 text-muted-foreground" aria-hidden />
        GPX
      </button>
      <button type="button" className={BUTTON} onClick={() => download('areo-route.geojson', 'application/geo+json', JSON.stringify(toGeoJson(exportInput(alt, hasBudget)), null, 1))}>
        <Download className="size-3.5 text-muted-foreground" aria-hidden />
        GeoJSON
      </button>
    </div>
  );
}
