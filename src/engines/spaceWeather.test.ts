import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cmesDuring, flareStrength, summarizeSpaceWeather, type DonkiFeed } from './spaceWeather';

/** A real slice of DONKI output; see its `_note`. One CME reaches Mars on 2026-11-13 12:00 UTC, in two model runs. */
const feed = JSON.parse(readFileSync(new URL('../../tests/fixtures/donki-2026-11.json', import.meta.url), 'utf8')) as DonkiFeed;
const at = (iso: string) => Date.parse(iso);
const ARRIVAL = at('2026-11-13T12:00Z');

describe('summarizeSpaceWeather on the DONKI fixture', () => {
  it('lists the CME bound for Mars once, though two model runs name it', () => {
    const sw = summarizeSpaceWeather(feed, at('2026-11-12T00:00Z'));
    expect(sw.cmes).toHaveLength(1);
    expect(sw.cmes[0]?.arrivalUtcMs).toBe(ARRIVAL);
    expect(sw.cmes[0]?.glancing).toBe(true);
    expect(sw.cmes[0]?.speedKms).toBeGreaterThan(200);
    expect(sw.cmes[0]?.link).toMatch(/^https:\/\/ccmc\.gsfc\.nasa\.gov\//);
  });

  it('is a watch when the CME is days away', () => {
    const sw = summarizeSpaceWeather(feed, at('2026-11-10T00:00Z'));
    expect(sw.status).toBe('watch');
    expect(sw.headline).toMatch(/in 4 days/);
  });

  it('is a warning within a day of the arrival, and for half a day after it', () => {
    expect(summarizeSpaceWeather(feed, at('2026-11-13T00:00Z')).status).toBe('warning');
    expect(summarizeSpaceWeather(feed, at('2026-11-13T20:00Z')).status).toBe('warning');
  });

  it('goes quiet once the cloud has passed, still naming it for two days', () => {
    const sw = summarizeSpaceWeather(feed, at('2026-11-14T13:00Z'));
    expect(sw.status).toBe('quiet');
    expect(sw.cmes).toHaveLength(1);
    expect(summarizeSpaceWeather(feed, at('2026-11-16T13:00Z')).cmes).toHaveLength(0);
  });

  it('does not count particle events that no instrument at Mars recorded', () => {
    const sw = summarizeSpaceWeather(feed, at('2026-09-06T00:00Z'));
    expect(sw.particlesAtMars).toHaveLength(0);
    expect(sw.particlesElsewhere).toBeGreaterThan(0);
    expect(sw.status).toBe('quiet');
  });

  it('warns when an instrument at Mars recorded particles in the last two days', () => {
    // The feed held no such event in 2026; this is a real entry with its instrument renamed.
    const real = feed.sep?.[0] as Record<string, unknown>;
    const atMars = { ...real, eventTime: '2026-11-13T09:00Z', instruments: [{ displayName: 'MSL: RAD >100 MeV' }] };
    const sw = summarizeSpaceWeather({ ...feed, enlil: [], sep: [atMars] }, at('2026-11-14T13:00Z'));
    expect(sw.particlesAtMars).toHaveLength(1);
    expect(sw.status).toBe('warning');
    expect(summarizeSpaceWeather({ ...feed, enlil: [], sep: [atMars] }, at('2026-11-17T13:00Z')).status).toBe('quiet');
  });

  it('names the strongest M or X flare', () => {
    const sw = summarizeSpaceWeather(feed, at('2026-11-14T13:00Z'));
    expect(sw.strongestFlare?.classType).toBe('M1.7');
  });

  it('says which feeds did not answer and still summarises the rest', () => {
    const sw = summarizeSpaceWeather({ fetched: feed.fetched, enlil: feed.enlil, sep: null, flr: null }, at('2026-11-12T18:00Z'));
    expect(sw.missing).toEqual(['sep', 'flr']);
    expect(sw.status).toBe('warning');
    const none = summarizeSpaceWeather({ fetched: feed.fetched, enlil: null, sep: null, flr: null }, at('2026-11-12T00:00Z'));
    expect(none.missing).toEqual(['enlil', 'sep', 'flr']);
    expect(none.status).toBe('unknown');
  });

  it('survives junk in the feed', () => {
    const junk = { fetched: 'never', enlil: [null, 3, { impactList: 'no' }, { impactList: [{ location: 'Mars', arrivalTime: 'soon' }] }], sep: [{}], flr: [{ classType: 7 }] } as unknown as DonkiFeed;
    const sw = summarizeSpaceWeather(junk, at('2026-11-12T00:00Z'));
    expect(sw.cmes).toEqual([]);
    expect(sw.strongestFlare).toBeNull();
    expect(sw.fetchedUtcMs).toBeNull();
  });
});

describe('cmesDuring', () => {
  const sw = summarizeSpaceWeather(feed, at('2026-11-10T00:00Z'));
  it('finds a CME that arrives while the crew is out, with half a day either side', () => {
    expect(cmesDuring(sw, at('2026-11-13T08:00Z'), at('2026-11-13T16:00Z'))).toHaveLength(1);
    expect(cmesDuring(sw, at('2026-11-13T20:00Z'), at('2026-11-13T23:00Z'))).toHaveLength(1);
    expect(cmesDuring(sw, at('2026-11-12T20:00Z'), at('2026-11-13T02:00Z'))).toHaveLength(1);
  });
  it('finds none for a trip well clear of it', () => {
    expect(cmesDuring(sw, at('2026-11-11T02:00Z'), at('2026-11-11T10:00Z'))).toHaveLength(0);
    expect(cmesDuring(sw, at('2026-11-14T06:00Z'), at('2026-11-14T12:00Z'))).toHaveLength(0);
  });
});

describe('flareStrength', () => {
  it('orders flare classes', () => {
    expect(flareStrength('X1.2')).toBeGreaterThan(flareStrength('M9.9'));
    expect(flareStrength('M2.0')).toBeGreaterThan(flareStrength('M1.7'));
    expect(flareStrength('C9')).toBeLessThan(flareStrength('M1'));
    expect(flareStrength('nonsense')).toBe(0);
  });
});
