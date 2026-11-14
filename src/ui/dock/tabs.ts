import { BookOpen, Compass, Flag, Layers, Users, type LucideIcon } from 'lucide-react';
import { NET_ENABLED } from '@/net/config';
import type { DockTab } from '@/store';

export const DOCK_TABS: readonly { id: DockTab; label: string; title: string; icon: LucideIcon }[] = [
  { id: 'layers', label: 'Layers', title: 'Map layers', icon: Layers },
  { id: 'discover', label: 'Discover', title: 'Discover', icon: Compass },
  { id: 'missions', label: 'Missions', title: 'Missions', icon: Flag },
  // Crews need the crew server; without one the app is solo and the tab would be empty.
  ...(NET_ENABLED ? [{ id: 'crew' as const, label: 'Crew', title: 'Crew', icon: Users }] : []),
  { id: 'how', label: 'How', title: 'How it works', icon: BookOpen },
];
