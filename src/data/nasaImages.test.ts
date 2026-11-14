import { describe, expect, it } from 'vitest';
import { parseImages } from './nasaImages';

const hit = (id: string, title: string, href = `https://images-assets.nasa.gov/image/${id}/${id}~thumb.jpg`, description = '') => ({
  data: [{ nasa_id: id, title, date_created: '2022-09-15T00:00:00Z', description }],
  links: [{ href, rel: 'preview' }],
});

describe('parseImages', () => {
  it('puts pictures named for the place first, marks illustrations and keeps to the limit', () => {
    const json = {
      collection: {
        items: [
          hit('PIA1', 'Abrasion patches at the delta'),
          hit('PIA2', 'Sample collection at Wildcat Ridge'),
          hit('PIA3', 'Ancient lake (Illustration)'),
          hit('PIA4', 'Not safe', 'http://example.com/x.jpg'),
        ],
      },
    };
    const out = parseImages(json, 'Wildcat Ridge', 2);
    expect(out.map((i) => i.id)).toEqual(['PIA2', 'PIA1']);
    expect(out[0]?.page).toBe('https://images.nasa.gov/details/PIA2');
    expect(parseImages(json, 'Lake', 5).find((i) => i.id === 'PIA3')?.illustration).toBe(true);
    // Only https previews are shown.
    expect(parseImages(json, 'x', 9).some((i) => i.id === 'PIA4')).toBe(false);
  });

  it('answers an empty list for anything that is not a library answer', () => {
    expect(parseImages(null, 'Jezero', 9)).toEqual([]);
    expect(parseImages({ collection: {} }, 'Jezero', 9)).toEqual([]);
  });
});
