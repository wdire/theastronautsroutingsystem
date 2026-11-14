import { describe, expect, it } from 'vitest';
import { normalise, searchItems, type SearchItem } from './search';

const item = (name: string, kind: SearchItem['kind'] = 'feature', weight = 1): SearchItem => ({
  key: `${kind}:${name}`,
  kind,
  name,
  hint: '',
  lon: 77,
  lat: 18,
  zoom: 10,
  weight,
});

const items = [
  item('Jezero', 'feature', 5),
  item('Cheyava Falls', 'place', 9),
  item('Nili Fossae', 'feature', 6),
  item('Neretva Vallis', 'feature', 3),
  item('Utopia Rupēs', 'feature', 2),
  item('Wildcat Ridge', 'place', 9),
  item('Falls Creek', 'feature', 1),
];

describe('search', () => {
  it('finds a place by the start of any word and ignores case and accents', () => {
    expect(searchItems(items, 'chey')[0]?.name).toBe('Cheyava Falls');
    // A name that starts with the query outranks one where a later word does.
    expect(searchItems(items, 'FALLS').map((i) => i.name)).toEqual(['Falls Creek', 'Cheyava Falls']);
    expect(searchItems(items, 'rupes')[0]?.name).toBe('Utopia Rupēs');
    expect(normalise('  Utopia   Rupēs! ')).toBe('utopia rupes');
  });

  it('ranks an exact name over a prefix over a match inside a word', () => {
    const list = [item('Nili'), item('Nili Fossae'), item('Anili Patera')];
    expect(searchItems(list, 'nili').map((i) => i.name)).toEqual(['Nili', 'Nili Fossae', 'Anili Patera']);
  });

  it('puts typed coordinates first', () => {
    const r = searchItems(items, '18.4446, 77.4509');
    expect(r[0]?.kind).toBe('coordinates');
    expect(r[0]?.lat).toBeCloseTo(18.4446);
    expect(r[0]?.lon).toBeCloseTo(77.4509);
  });

  it('returns nothing for an empty or unmatched query and respects the limit', () => {
    expect(searchItems(items, '   ')).toEqual([]);
    expect(searchItems(items, 'zzzz')).toEqual([]);
    expect(searchItems(items, 'e', 3)).toHaveLength(3);
  });
});
