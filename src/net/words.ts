import type { Severity } from '@/engines/types';

/** The word for each severity, as the alert card shows it (src/ui/alerts/severity.ts), without its icons. */
export const SEVERITY_WORD: Record<Severity, string> = { note: 'Note', advisory: 'Advisory', caution: 'Caution', warning: 'Warning' };

/** "@Base" anywhere in a call, as its own word. */
const BASE_CALL = /(^|[^\w@])@base\b[\s,.:;!?-]*/i;

/**
 * On a crew radio the crew talk among themselves; the base answers only a call addressed to it with "@Base".
 * Returns what the base is asked (the call without its call sign), or null when the call is not for the base.
 */
export function baseQuestion(text: string): string | null {
  if (!BASE_CALL.test(text)) return null;
  const rest = text.replace(BASE_CALL, '$1').replace(/\s+/g, ' ').trim();
  return rest.length > 0 ? rest : text.trim();
}

/** The call without its "@Base" call sign (the radio's call-the-base toggle turned off). */
export function withoutBaseCall(text: string): string {
  return text.replace(BASE_CALL, '$1').trimStart();
}

/** Splits a call into plain text and its "@Base" call signs, so the radio can show who was called. */
export function splitBaseCalls(text: string): { text: string; call: boolean }[] {
  return text
    .split(/(@base\b)/i)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, call: /^@base$/i.test(part) }));
}
