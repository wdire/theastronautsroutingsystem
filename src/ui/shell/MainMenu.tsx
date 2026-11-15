import { AudioLines, Globe2, Link2, Menu, Moon, Sun, Volume2, VolumeOff, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { getMap } from '@/map/instance';
import { flyOut } from '@/map/camera';
import { useApp } from '@/store';
import { useSound } from '@/audio/useSound';

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast('Link copied', { description: 'It opens this view and this plan.' });
  } catch {
    toast('Could not copy the link', { description: 'Copy the address from the browser bar instead.' });
  }
}

/** The menu behind the button in the search box. On a phone it also holds the panel tabs. */
export function MainMenu() {
  const theme = useApp((s) => s.theme);
  const spoken = useApp((s) => s.spokenAlerts);
  const setTheme = useApp((s) => s.setTheme);
  const [sound, setSound] = useSound();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-foreground/85 transition-colors outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary"
        >
          <Menu className="size-[18px]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={10} alignOffset={-4} className="w-60">
        <DropdownMenuItem
          onSelect={() => {
            const map = getMap();
            if (map) flyOut(map);
          }}
        >
          <Globe2 aria-hidden />
          Back to the planet
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyLink()}>
          <Link2 aria-hidden />
          Copy a link to this view
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setSound(!sound)}>
          {sound ? <VolumeOff aria-hidden /> : <AudioLines aria-hidden />}
          {sound ? 'Turn sound effects off' : 'Turn sound effects on'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useApp.setState({ spokenAlerts: !spoken })}>
          {spoken ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          {spoken ? 'Stop speaking alerts' : 'Speak mission alerts aloud'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {theme === 'dark' ? 'Light panels' : 'Dark panels'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
