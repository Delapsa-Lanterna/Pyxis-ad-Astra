import { describe, it, expect } from 'vitest';
import { normalizeWeaponSpec } from './lib/normalize';
import { findMirrorBarrelIndex } from './lib/mirror';
import { addWeaponBarrel, updateWeaponBarrel, deleteWeaponBarrel, previewWeaponOperation, projectWeaponBarrels } from './weapon-editing';

describe('weapon barrel geometry', () => {
  it.each(['turret', 'hardpoint'] as const)(
    'mirrors %s points above and below the horizontal axis through add, drag, rotate and delete',
    (mode) => {
      const weapon = normalizeWeaponSpec({ id: 'weapon', custom: { keep: true } });
      const added = addWeaponBarrel(weapon, mode, { x: 32, y: 12 }, true),
        g = projectWeaponBarrels(weapon, mode);
      expect(g.offsets).toEqual([32, 12, 32, -12]);
      expect(findMirrorBarrelIndex(g.offsets, 0)).toBe(1);
      updateWeaponBarrel(weapon, mode, added.i, added.pair, 'offset', { x: 41, y: 17 });
      expect(g.offsets).toEqual([41, 17, 41, -17]);
      updateWeaponBarrel(weapon, mode, added.i, added.pair, 'angle', { x: 42, y: 18 });
      expect(g.angles).toEqual([45, 315]);
      deleteWeaponBarrel(weapon, mode, 0, true);
      expect(g.offsets).toEqual([]);
      expect(g.angles).toEqual([]);
      expect(weapon.custom).toEqual({ keep: true });
    },
  );
  it('adds one point on the horizontal centerline and rejects a left-right pair', () => {
    const weapon = normalizeWeaponSpec({});
    expect(addWeaponBarrel(weapon, 'turret', { x: 37, y: 0 }, true).pair).toBeNull();
    expect(projectWeaponBarrels(weapon, 'turret').offsets).toEqual([37, 0]);
    expect(findMirrorBarrelIndex([-20, 12, 20, 12], 0)).toBeNull();
  });
  it('uses the same snapped location for combined-key preview and creation', () => {
    const weapon = normalizeWeaponSpec({}),
      keys = { shiftKey: true, ctrlKey: true, altKey: true },
      point = { x: 2.24, y: 3.74 };
    const preview = previewWeaponOperation(weapon, 'turret', null, keys, point);
    expect(preview).toEqual({ kind: 'add', coord: { x: 2, y: 3.5 } });
    addWeaponBarrel(weapon, 'turret', { x: 2, y: 3.5 }, false);
    expect(projectWeaponBarrels(weapon, 'turret').offsets).toEqual([2, 3.5]);
  });
});
