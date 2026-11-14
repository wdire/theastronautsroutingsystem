import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cyclesPerMetre, suitWeights } from './suit';

const total = (w: Partial<Record<string, number>>) => Object.values(w).reduce((n: number, v) => n + (v ?? 0), 0);

describe('suitWeights', () => {
  it('always adds up to one', () => {
    for (let y = 0; y <= 1.9; y += 0.07) {
      for (let x = -0.5; x <= 0.5; x += 0.09) {
        for (const z of [-0.6, -0.3, -0.05, 0.1]) expect(total(suitWeights(new Vector3(x, y, z)))).toBeCloseTo(1, 6);
      }
    }
  });
  it('gives a shin to its own side only', () => {
    const left = suitWeights(new Vector3(-0.18, 0.3, 0));
    expect(left.kneeL).toBeGreaterThan(0.9);
    expect(left.kneeR).toBeUndefined();
    expect(suitWeights(new Vector3(0.18, 0.3, 0)).kneeR).toBeGreaterThan(0.9);
  });
  it('blends the top of a thigh into the pelvis', () => {
    const w = suitWeights(new Vector3(0.12, 0.9, 0));
    expect(w.pelvis).toBeGreaterThan(0.3);
    expect(w.hipR).toBeGreaterThan(0.3);
  });
  it('puts the helmet on the head and the chest pack on the chest', () => {
    expect(suitWeights(new Vector3(0, 1.75, 0)).head).toBeCloseTo(1, 6);
    expect(suitWeights(new Vector3(0, 1.42, -0.15)).chest).toBeGreaterThan(0.9);
  });
  it('moves a forearm with the elbow and a glove with the hand', () => {
    expect(suitWeights(new Vector3(0.31, 1.18, -0.38)).elbowR).toBeGreaterThan(0.8);
    expect(suitWeights(new Vector3(0.28, 1.1, -0.6)).handR).toBeGreaterThan(0.9);
    expect(suitWeights(new Vector3(-0.28, 1.1, -0.6)).handL).toBeGreaterThan(0.9);
  });
});

describe('cyclesPerMetre', () => {
  it('takes shorter strides when slow and longer ones when fast, within limits', () => {
    expect(1 / cyclesPerMetre(0)).toBeCloseTo(0.9, 6);
    expect(1 / cyclesPerMetre(0.92)).toBeCloseTo(1.11, 2);
    expect(1 / cyclesPerMetre(5)).toBeCloseTo(1.9, 6);
  });
});
