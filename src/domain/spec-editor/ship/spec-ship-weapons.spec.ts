import { describe, expect, it } from 'vitest';
import type { RowData } from '@/shared/types';
import { projectShipWeapons, shipBuiltInWeaponIds, type ShipWeaponSources } from '@/domain/spec-editor/ship/spec-ship-weapons';

const source: ShipWeaponSources = {
  baseVersions: [],
  hints: ['WEAPONS_FRONT_TO_BACK'],
  diagnostic: '',
  weapons: {
    gun: {
      spec: { specClass: 'projectile', size: 'SMALL', type: 'BALLISTIC' },
      resources: {
        turretSprite: { source: 'core', relPath: 'graphics/gun.png', ownerKind: 'weapon', ownerId: 'gun', key: 'turretSprite' },
      },
      projectile: {},
      projectileResources: {},
      diagnostic: '',
    },
    missing: { spec: null, resources: {}, projectile: {}, projectileResources: {}, diagnostic: '武器规格缺失' },
  },
};
const slot = (id: string): RowData => ({ id, type: 'BALLISTIC', mount: 'TURRET', size: 'LARGE', angle: 0, locations: [0, 0] });
describe('ship built-in rendering membership', () => {
  it('takes equipment solely from the current built-in map and deduplicates read IDs', () => {
    const ship = { weaponSlots: [slot('A'), slot('B'), { ...slot('C'), type: 'BUILT_IN' }], builtInWeapons: { A: 'gun', B: 'gun' } };
    expect(shipBuiltInWeaponIds(ship)).toEqual(['gun']);
    const result = projectShipWeapons(ship, source);
    expect(result.weapons.map((weapon) => [weapon.slot.id, weapon.weaponId, weapon.renderOrder])).toEqual([
      ['A', 'gun', 20],
      ['B', 'gun', 20],
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(projectShipWeapons({ ...ship, builtInWeapons: { B: 'gun' } }, source).weapons.map((weapon) => weapon.slot.id)).toEqual(['B']);
  });
  it('projects current geometry and hull hints while retaining the actual slot identity', () => {
    const ownSlot = slot('A'),
      ship = { weaponSlots: [ownSlot], builtInWeapons: { A: 'gun' } };
    ownSlot.locations = [100, 0];
    ownSlot.angle = 45;
    ownSlot.renderOrderMod = 2;
    const weapon = projectShipWeapons(ship, source).weapons[0]!;
    expect(weapon.slot).toBe(ownSlot);
    expect(weapon.renderOrder).toBeCloseTo(21.99, 5);
  });
  it('reports concrete missing references and keeps the available weapon', () => {
    const result = projectShipWeapons(
      { weaponSlots: [slot('A'), slot('B'), slot('D')], builtInWeapons: { A: 'gun', B: 'missing', C: 'gun', D: '' } },
      source,
    );
    expect(result.weapons.map((weapon) => weapon.slot.id)).toEqual(['A']);
    expect(result.diagnostics).toEqual([
      '槽位 B · 武器 missing：武器规格缺失',
      '槽位 C · 武器 gun：槽位缺失',
      '槽位 D · 武器 （空引用）：武器引用为空或无效',
    ]);
  });
});
