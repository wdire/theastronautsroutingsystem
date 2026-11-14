import { describe, expect, it } from 'vitest';
import { settle, sheetHeights } from './sheetStops';

describe('sheetHeights', () => {
  it('fits a phone: a small stop, about half the screen, and nearly all of it', () => {
    const h = sheetHeights(844, 70, 64);
    expect(h.peek).toBe(132);
    expect(h.half).toBeGreaterThan(380);
    expect(h.half).toBeLessThan(430);
    expect(h.full).toBe(844 - 70 - 64);
  });
  it('never asks for more than the screen has, even with the keyboard up', () => {
    const h = sheetHeights(380, 70, 64);
    expect(h.full).toBe(380 - 70 - 64);
    expect(h.half).toBeLessThanOrEqual(h.full);
    expect(h.peek).toBeLessThanOrEqual(h.half);
  });
});

describe('settle', () => {
  const h = sheetHeights(844, 70, 64);
  it('snaps to the nearest stop when let go at rest', () => {
    expect(settle(150, 0, h)).toBe('peek');
    expect(settle(h.half + 30, 0, h)).toBe('half');
    expect(settle(h.full - 40, 0, h)).toBe('full');
  });
  it('lets a flick carry it to the next stop', () => {
    expect(settle(h.half + 20, 1.6, h)).toBe('full');
    expect(settle(h.half - 20, -1.6, h)).toBe('peek');
  });
});
