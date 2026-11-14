/**
 * Who this browser is to the crew server. There are no accounts: a random id and a secret are made once and
 * kept in localStorage, and the server keeps only a hash of the secret. The callsign and suit colour are the
 * visitor's to change; a default is picked so nobody has to fill in a form before seeing who is online.
 */
import { SUIT_COLORS, LIMITS, type SuitColor } from '../../convex/shared';

export interface Identity {
  clientId: string;
  secret: string;
  name: string;
  color: SuitColor;
}

/** Length of the public id and of the secret, in url-safe characters (6 bits each: 132 and 258 bits). */
export const CLIENT_ID_LENGTH = 22;
export const SECRET_LENGTH = 43;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const STORAGE_KEY = 'areo.identity.v1';

// Mars features for default callsigns: volcanoes, valleys and plains a crew would know by name.
const FEATURES = ['Tharsis', 'Arsia', 'Pavonis', 'Ascraeus', 'Olympus', 'Elysium', 'Hellas', 'Argyre', 'Isidis', 'Syrtis', 'Nili', 'Jezero', 'Gale', 'Meridiani', 'Utopia', 'Chryse', 'Valles', 'Noctis', 'Acidalia', 'Arabia'] as const;

type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
const cryptoFill: RandomFill = (bytes) => crypto.getRandomValues(bytes);

/** A random string of url-safe characters. 64 divides 256, so taking the low six bits keeps every character equally likely. */
export function randomToken(length: number, fill: RandomFill = cryptoFill): string {
  const bytes = fill(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[(bytes[i] ?? 0) & 63];
  return out;
}

export function isClientId(x: unknown): x is string {
  return typeof x === 'string' && x.length === CLIENT_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(x);
}

export function isSecret(x: unknown): x is string {
  return typeof x === 'string' && x.length === SECRET_LENGTH && /^[A-Za-z0-9_-]+$/.test(x);
}

export function isSuitColor(x: unknown): x is SuitColor {
  return typeof x === 'string' && (SUIT_COLORS as readonly string[]).includes(x);
}

/** Trims and caps a callsign; null when nothing is left. */
export function cleanName(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const name = x.replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
  return name.length > 0 ? name : null;
}

/** "Tharsis 41": a Mars feature and a number, like a radio callsign. */
export function defaultCallsign(fill: RandomFill = cryptoFill): string {
  const [a = 0, b = 0] = fill(new Uint8Array(2));
  return `${FEATURES[a % FEATURES.length]} ${(b % 98) + 2}`;
}

export function randomColor(fill: RandomFill = cryptoFill): SuitColor {
  const [a = 0] = fill(new Uint8Array(1));
  return SUIT_COLORS[a % SUIT_COLORS.length] ?? 'signal';
}

export function newIdentity(fill: RandomFill = cryptoFill): Identity {
  return { clientId: randomToken(CLIENT_ID_LENGTH, fill), secret: randomToken(SECRET_LENGTH, fill), name: defaultCallsign(fill), color: randomColor(fill) };
}

/** An identity read back from storage, or null if anything in it is missing or malformed. */
export function parseIdentity(raw: string | null): Identity | null {
  if (!raw) return null;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const name = cleanName(o.name);
  if (!isClientId(o.clientId) || !isSecret(o.secret) || !name || !isSuitColor(o.color)) return null;
  return { clientId: o.clientId, secret: o.secret, name, color: o.color };
}

/** The part of Storage this needs, so tests can pass a map. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Private windows and blocked storage throw; the identity then lasts as long as the page.
let memory: Identity | null = null;

function storage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The identity this browser already has, or a new one, saved where it can be. */
export function loadIdentity(store: KeyValue | null = storage()): Identity {
  if (memory) return memory;
  let found: Identity | null;
  try {
    found = parseIdentity(store?.getItem(STORAGE_KEY) ?? null);
  } catch {
    found = null;
  }
  const identity = found ?? newIdentity();
  memory = identity;
  if (!found) saveIdentity(identity, store);
  return identity;
}

export function saveIdentity(identity: Identity, store: KeyValue | null = storage()): void {
  memory = identity;
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Storage full or blocked: the identity still holds for this visit.
  }
}

/** For tests: forget the identity held in memory. */
export function resetIdentityMemory(): void {
  memory = null;
}
