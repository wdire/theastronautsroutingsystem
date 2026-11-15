import { describe, expect, it } from 'vitest';
import { baseQuestion, splitBaseCalls } from './words';

describe('baseQuestion', () => {
  it('answers only calls addressed to the base', () => {
    expect(baseQuestion('How is our oxygen?')).toBeNull();
    expect(baseQuestion('the base is far')).toBeNull();
    expect(baseQuestion('mail me@base.org')).toBeNull();
  });

  it('takes the call sign out of the question, wherever it is', () => {
    expect(baseQuestion('@Base how is our oxygen?')).toBe('how is our oxygen?');
    expect(baseQuestion('@base, how is our oxygen?')).toBe('how is our oxygen?');
    expect(baseQuestion('How long to sunset @BASE?')).toBe('How long to sunset');
    expect(baseQuestion('@Base')).toBe('@Base');
  });
});

describe('splitBaseCalls', () => {
  it('marks the call signs', () => {
    expect(splitBaseCalls('@Base air?')).toEqual([
      { text: '@Base', call: true },
      { text: ' air?', call: false },
    ]);
    expect(splitBaseCalls('no call')).toEqual([{ text: 'no call', call: false }]);
  });
});
