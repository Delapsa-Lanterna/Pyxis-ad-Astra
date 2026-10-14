import { describe, expect, it } from 'vitest';
import { projectProjectileGeometry } from './projectile-geometry';
import { normalizeProjectileSpec } from './lib/projectile-fields';
describe('projectile geometry', () => {
  it('projects a missile body and engines into the same forward-facing space', () => {
    const spec = normalizeProjectileSpec({
      specClass: 'missile',
      size: [12, 30],
      center: [3, 8],
      collisionRadius: 20,
      engineSlots: [{ loc: [-10, 6], angle: 180, width: 8, length: 20 }],
    });
    const result = projectProjectileGeometry(spec);
    expect(result.body).toEqual({ x: -8, y: -3, width: 30, height: 12 });
    expect(result.engines[0]!.point).toEqual({ x: -10, y: -6 });
    expect(result.extent.x).toBeCloseTo(30);
    expect(result.extent.y).toBe(20);
    expect(spec.engineSlots).toEqual([{ loc: [-10, 6], angle: 180, width: 8, length: 20 }]);
  });
});
