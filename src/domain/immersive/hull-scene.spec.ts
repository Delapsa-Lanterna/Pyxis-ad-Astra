import { describe, it, expect } from 'vitest';
import { immersiveHullPoint, immersiveWingFormation, immersiveWingLayout } from './hull-scene';
describe('upright variant preview coordinates', () => {
  it('maps the hull longitudinal axis forward and its lateral axis to port', () => {
    expect(immersiveHullPoint([116, -15])).toEqual({ x: 15, y: -116 });
    expect(immersiveHullPoint([-39, 33])).toEqual({ x: -33, y: 39 });
  });
  it('uses the original wing formation and caps the rendered count at six', () => {
    expect(immersiveWingFormation(3, 'V')).toEqual([
      { x: 0, y: -0.33 },
      { x: -0.33, y: 0.2 },
      { x: 0.33, y: 0.2 },
    ]);
    expect(immersiveWingFormation(4, 'BOX')).toHaveLength(4);
    expect(immersiveWingFormation(10, 'CLAW')).toHaveLength(6);
    expect(immersiveWingFormation(0, 'V')).toEqual([]);
  });
  it('matches the original Sarissa CLAW placement and count-dependent sprite size', () => {
    const layout = immersiveWingLayout(3, 'CLAW', 72);
    expect(layout.points[0]!.x).toBe(0);
    expect(layout.points[0]!.y).toBeCloseTo(11.88);
    expect(layout.points[1]!.x).toBeCloseTo(-11.88);
    expect(layout.points[1]!.y).toBeCloseTo(-7.2);
    expect(layout.points[2]!.x).toBeCloseTo(11.88);
    expect(layout.points[2]!.y).toBeCloseTo(-7.2);
    expect(layout.spriteHeight).toBeCloseTo(21.6);
  });
  it.each(['V', 'CLAW', 'BOX', 'DIAMOND'])('consumes all original count branches for %s', (formation) => {
    for (let count = 0; count <= 6; count++) {
      const layout = immersiveWingLayout(count, formation, 72);
      expect(layout.points).toHaveLength(count);
      expect(layout.spriteHeight).toBeCloseTo(27 * (1 - count / 15));
      expect(layout.diagnostic).toBe('');
    }
  });
  it('uses the original default shape for DIAMOND and original six-icon cap', () => {
    expect(immersiveWingLayout(4, 'DIAMOND', 72).points).toEqual([
      { x: 0, y: -14.4 },
      { x: -14.4, y: -0 },
      { x: 14.4, y: -0 },
      { x: 0, y: 14.4 },
    ]);
    const layout = immersiveWingLayout(10, 'BOX', 72);
    expect(layout.points).toHaveLength(6);
    expect(layout.spriteHeight).toBeCloseTo(9);
  });
  it.each(['', 'unknown'])('diagnoses a missing or invalid formation %s', (formation) => {
    expect(immersiveWingLayout(3, formation, 72)).toMatchObject({ points: [], diagnostic: expect.stringContaining('阵型') });
  });
  it.each([NaN, -1, 2.5])('diagnoses invalid source count %s', (count) => {
    expect(immersiveWingLayout(count, 'CLAW', 72)).toMatchObject({ points: [], diagnostic: '战机数量缺失或无效' });
  });
});
