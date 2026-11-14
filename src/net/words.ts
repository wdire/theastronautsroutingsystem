import type { Severity } from '@/engines/types';

/** The word for each severity, as the alert card shows it (src/ui/alerts/severity.ts), without its icons. */
export const SEVERITY_WORD: Record<Severity, string> = { note: 'Note', advisory: 'Advisory', caution: 'Caution', warning: 'Warning' };
