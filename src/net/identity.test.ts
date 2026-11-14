import { describe, expect, it } from 'vitest';
import { CLIENT_ID_LENGTH, SECRET_LENGTH, cleanName, defaultCallsign, isClientId, isSecret, loadIdentity, newIdentity, parseIdentity, randomToken, resetIdentityMemory, saveIdentity, type KeyValue } from './identity';

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('identity', () => {
  it('makes ids and secrets the server accepts', () => {
    const id = newIdentity();
    expect(id.clientId).toHaveLength(CLIENT_ID_LENGTH);
    expect(id.secret).toHaveLength(SECRET_LENGTH);
    // The server's own rule (convex/people.ts register).
    expect(id.clientId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(id.secret.length).toBeGreaterThanOrEqual(32);
    expect(isClientId(id.clientId) && isSecret(id.secret)).toBe(true);
  });

  it('uses every character of the alphabet and nothing else', () => {
    const seen = new Set(randomToken(4000));
    expect(seen.size).toBe(64);
    for (const c of seen) expect(c).toMatch(/[A-Za-z0-9_-]/);
  });

  it('never repeats an id', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomToken(CLIENT_ID_LENGTH)));
    expect(ids.size).toBe(500);
  });

  it('gives a callsign of a Mars feature and a number', () => {
    for (let i = 0; i < 50; i++) expect(defaultCallsign()).toMatch(/^[A-Z][a-z]+ \d{1,2}$/);
  });

  it('cleans names and refuses empty ones', () => {
    expect(cleanName('  Arsia   7 ')).toBe('Arsia 7');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('x'.repeat(80))).toHaveLength(32);
  });

  it('reads back only a well-formed identity', () => {
    const id = newIdentity();
    expect(parseIdentity(JSON.stringify(id))).toEqual(id);
    expect(parseIdentity(null)).toBeNull();
    expect(parseIdentity('{nope')).toBeNull();
    expect(parseIdentity(JSON.stringify({ ...id, secret: 'short' }))).toBeNull();
    expect(parseIdentity(JSON.stringify({ ...id, clientId: 'has spaces in it ok?!' }))).toBeNull();
    expect(parseIdentity(JSON.stringify({ ...id, color: 'mauve' }))).toBeNull();
    expect(parseIdentity(JSON.stringify({ ...id, name: '' }))).toBeNull();
  });

  it('keeps one identity per browser, and makes a new one when storage holds junk', () => {
    resetIdentityMemory();
    const store = memoryStore();
    const first = loadIdentity(store);
    resetIdentityMemory();
    expect(loadIdentity(store)).toEqual(first);
    resetIdentityMemory();
    store.data.set([...store.data.keys()][0] ?? '', 'garbage');
    expect(loadIdentity(store).clientId).not.toBe(first.clientId);
  });

  it('still works when storage throws', () => {
    resetIdentityMemory();
    const broken: KeyValue = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const id = loadIdentity(broken);
    expect(isClientId(id.clientId)).toBe(true);
    saveIdentity({ ...id, name: 'Gale 3' }, broken);
    expect(loadIdentity(broken).name).toBe('Gale 3');
    resetIdentityMemory();
  });
});
