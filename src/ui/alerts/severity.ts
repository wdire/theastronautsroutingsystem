import { Info, MessageSquare, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Severity } from '@/engines/types';

/**
 * One look per severity, the same on the map, in the plan and in the helmet: a colour, an icon and a
 * word, so nothing is told by colour alone.
 */
export const SEVERITY: Record<Severity, { word: string; icon: LucideIcon; text: string; border: string; bg: string; dot: string }> = {
  note: { word: 'Note', icon: MessageSquare, text: 'text-muted-foreground', border: 'border-border', bg: 'bg-transparent', dot: 'bg-faint' },
  advisory: { word: 'Advisory', icon: Info, text: 'text-advisory', border: 'border-advisory/45', bg: 'bg-advisory/10', dot: 'bg-advisory' },
  caution: { word: 'Caution', icon: TriangleAlert, text: 'text-caution', border: 'border-caution/50', bg: 'bg-caution/10', dot: 'bg-caution' },
  warning: { word: 'Warning', icon: OctagonAlert, text: 'text-warning', border: 'border-warning/55', bg: 'bg-warning/10', dot: 'bg-warning' },
};

export const SEVERITY_ORDER: readonly Severity[] = ['warning', 'caution', 'advisory', 'note'];
