import { BookOpen, Compass, Flag, Layers, RadioTower, Route, Users, type LucideIcon } from 'lucide-react';
import type { DockTab } from '@/store';

export const DOCK_TABS: readonly { id: DockTab; label: string; title: string; icon: LucideIcon }[] = [
  { id: 'layers', label: 'Layers', title: 'Map layers', icon: Layers },
  { id: 'discover', label: 'Discover', title: 'Discover', icon: Compass },
  { id: 'missions', label: 'Missions', title: 'Missions', icon: Flag },
  { id: 'rover', label: 'Rover', title: 'Perseverance track', icon: Route },
  { id: 'base', label: 'Base', title: 'Base', icon: RadioTower },
  { id: 'crew', label: 'Crew', title: 'Crew', icon: Users },
  { id: 'how', label: 'How', title: 'How it works', icon: BookOpen },
];
