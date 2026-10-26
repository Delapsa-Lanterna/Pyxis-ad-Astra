import { describe, expect, it } from 'vitest';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { projectVariantPanel, type VariantWeapon } from './variant-panel';
import {
  sevenWeaponGroups,
  sortedGroupWeapons,
  assignGroupWeapons,
  matchingGroupWeapons,
  groupColor,
  groupWeaponColor,
  groupDialogHeight,
  groupTableHeight,
} from './variant-weapon-groups';

const sample = (): VariantWeapon => projectVariantPanel(variantJointFixture(), {}).variants[0]!.weapons[0]!;
describe('original weapon group projection', () => {
  it('provides seven independent groups and preserves source fields', () => {
    const data = { weaponGroups: [{ mode: 'ALTERNATING', autofire: true, weapons: { A: 'gun' }, custom: { value: '007' } }] };
    const groups = sevenWeaponGroups(data);
    expect(groups).toHaveLength(7);
    expect(groups[0]).toEqual(data.weaponGroups[0]);
    expect(groups[6]).toEqual({ mode: 'LINKED', autofire: false, weapons: {} });
    (groups[0]!.weapons as Record<string, string>).A = 'changed';
    expect(data.weaponGroups[0]!.weapons.A).toBe('gun');
    expect(sevenWeaponGroups({})).toHaveLength(7);
  });
  it('uses the original slot ordering before formal slot identity', () => {
    const make = (id: string, type: string, size: string, mount: string): VariantWeapon => ({
      ...sample(),
      slot: { id, type, size, mount },
    });
    const rows = sortedGroupWeapons([
      make('a', 'BALLISTIC', 'SMALL', 'TURRET'),
      make('b', 'MISSILE', 'MEDIUM', 'TURRET'),
      make('c', 'BUILT_IN', 'SMALL', 'TURRET'),
      make('d', 'ENERGY', 'LARGE', 'TURRET'),
      make('f', 'MISSILE', 'MEDIUM', 'HARDPOINT'),
      make('e', 'MISSILE', 'MEDIUM', 'HARDPOINT'),
      make('decoration', 'DECORATIVE', 'LARGE', 'TURRET'),
      { ...make('empty', 'ENERGY', 'LARGE', 'TURRET'), id: '' },
    ]);
    expect(rows.map((weapon) => weapon.slot.id)).toEqual(['c', 'd', 'e', 'f', 'b', 'a']);
  });
  it('assigns a matching batch including a built-in while preserving other memberships', () => {
    const template = sample();
    const rows = [
      { ...template, id: 'gun', slot: { id: 'A', mount: 'TURRET' } },
      { ...template, id: 'gun', builtin: true, slot: { id: 'B', mount: 'TURRET' } },
      { ...template, id: 'gun', slot: { id: 'C', mount: 'HARDPOINT' } },
      { ...template, id: 'other', slot: { id: 'D', mount: 'TURRET' } },
    ];
    const groups = sevenWeaponGroups({ weaponGroups: [{ mode: 'LINKED', weapons: { A: 'gun', C: 'gun', D: 'other' }, custom: 'keep' }] });
    const targets = matchingGroupWeapons(rows, rows[0]!);
    expect(targets.map((weapon) => weapon.slot.id)).toEqual(['A', 'B']);
    const next = assignGroupWeapons(groups, targets, 6);
    expect(next[0]).toMatchObject({ weapons: { C: 'gun', D: 'other' }, custom: 'keep' });
    expect(next[6]!.weapons).toEqual({ A: 'gun', B: 'gun' });
    expect(groups[0]!.weapons).toEqual({ A: 'gun', C: 'gun', D: 'other' });
  });
  it.each([
    [['ENERGY'], '#46c8ff'],
    [['MISSILE'], '#9bff00'],
    [['BALLISTIC'], '#ffd700'],
    [['ENERGY', 'BALLISTIC'], '#ffa500'],
    [['MISSILE', 'BALLISTIC'], '#d7ff00'],
    [['ENERGY', 'MISSILE'], '#00ffc8'],
    [['HYBRID', 'MISSILE'], '#ffffff'],
    [[], '#ffffff'],
  ])('combines weapon type colors for %s', (types, color) => {
    expect(groupColor(types.map((type) => ({ ...sample(), type })))).toBe(color);
  });
  it('uses built-in slot color and the original dialog row count sizing', () => {
    expect(groupWeaponColor({ ...sample(), type: 'MISSILE', slot: { type: 'BUILT_IN' } })).toBe('#ffffff');
    expect([0, 15, 16, 24, 30].map(groupDialogHeight)).toEqual([461, 461, 482, 650, 650]);
    expect([0, 15, 16, 24, 30].map(groupTableHeight)).toEqual([338, 338, 359, 527, 527]);
  });
});
