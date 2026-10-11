import { describe, it, expect } from 'vitest';
import { weaponMountShapes } from './weapon-icon';
describe('original weapon mount indicators', () => {
  it.each([
    ['BALLISTIC', 'square', '#ffd700'],
    ['ENERGY', 'circle', '#46c8ff'],
    ['MISSILE', 'diamond', '#9bff00'],
  ])('projects %s type and three size rings', (type, kind, color) => {
    expect(weaponMountShapes(type, 'SMALL')).toEqual([{ kind, color, radius: 20, alpha: 0.5 }]);
    expect(weaponMountShapes(type, 'MEDIUM').map((shape) => [shape.radius, shape.alpha])).toEqual([
      [30, 0.5],
      [20, 0.25],
    ]);
    expect(weaponMountShapes(type, 'LARGE').map((shape) => [shape.radius, shape.alpha])).toEqual([
      [40, 0.5],
      [30, 0.25],
      [20, 0.125],
    ]);
  });
  it('composes hybrid and universal shapes', () => {
    expect(weaponMountShapes('HYBRID', 'SMALL').map((shape) => shape.kind)).toEqual(['circle', 'square']);
    expect(weaponMountShapes('UNIVERSAL', 'LARGE').map((shape) => shape.kind)).toEqual(['circle', 'square', 'diamond']);
  });
});
