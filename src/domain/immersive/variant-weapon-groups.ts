import type { RowData } from '@/shared/types';
import type { VariantWeapon } from './variant-panel';
import { deepClone } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { weaponTypeColor } from './weapon-icon';
import { variantWeaponGroups } from './variant-actions';

export const WEAPON_GROUP_COUNT = 7;
const weaponTypes = [
  'BALLISTIC',
  'ENERGY',
  'MISSILE',
  'LAUNCH_BAY',
  'UNIVERSAL',
  'HYBRID',
  'SYNERGY',
  'COMPOSITE',
  'BUILT_IN',
  'DECORATIVE',
  'SYSTEM',
  'STATION_MODULE',
];
const sizes = ['SMALL', 'MEDIUM', 'LARGE'];
const mounts = ['TURRET', 'HARDPOINT', 'HIDDEN'];
export const groupWeapons = (group: Readonly<RowData>): RowData => (isRowData(group.weapons) ? group.weapons : {});
export function sevenWeaponGroups(data: Readonly<RowData>): RowData[] {
  const original = variantWeaponGroups(data);
  return Array.from({ length: WEAPON_GROUP_COUNT }, (_, index) => ({
    mode: 'LINKED',
    autofire: false,
    weapons: {},
    ...deepClone(original[index] ?? {}),
  }));
}
export function sortedGroupWeapons(weapons: readonly VariantWeapon[]): VariantWeapon[] {
  return weapons
    .filter((weapon) => weapon.id && weapon.slot.type !== 'DECORATIVE')
    .sort(
      (a, b) =>
        Number(b.slot.type === 'BUILT_IN') - Number(a.slot.type === 'BUILT_IN') ||
        sizes.indexOf(schemaStringValue(b.slot.size)) - sizes.indexOf(schemaStringValue(a.slot.size)) ||
        weaponTypes.indexOf(schemaStringValue(b.slot.type)) - weaponTypes.indexOf(schemaStringValue(a.slot.type)) ||
        mounts.indexOf(schemaStringValue(b.slot.mount)) - mounts.indexOf(schemaStringValue(a.slot.mount)) ||
        schemaStringValue(a.slot.id).localeCompare(schemaStringValue(b.slot.id), 'en'),
    );
}
export function assignGroupWeapons(groups: readonly RowData[], weapons: readonly VariantWeapon[], destination: number): RowData[] {
  const next = deepClone([...groups]);
  for (const weapon of weapons) {
    const slot = schemaStringValue(weapon.slot.id);
    for (const group of next) delete groupWeapons(group)[slot];
    next[destination]!.weapons = { ...groupWeapons(next[destination]!), [slot]: weapon.id };
  }
  return next;
}
export function matchingGroupWeapons(weapons: readonly VariantWeapon[], selected: VariantWeapon): VariantWeapon[] {
  return weapons.filter((weapon) => weapon.id === selected.id && weapon.slot.mount === selected.slot.mount);
}
export function groupWeaponColor(weapon: VariantWeapon): string {
  return weaponTypeColor(weapon.slot.type === 'BUILT_IN' ? 'BUILT_IN' : weapon.type);
}
export function groupColor(weapons: readonly VariantWeapon[]): string {
  const types = new Set(
    weapons.flatMap((weapon) => {
      if (weapon.type === 'UNIVERSAL') return ['BALLISTIC', 'ENERGY', 'MISSILE'];
      if (weapon.type === 'HYBRID') return ['BALLISTIC', 'ENERGY'];
      if (weapon.type === 'COMPOSITE') return ['BALLISTIC', 'MISSILE'];
      if (weapon.type === 'SYNERGY') return ['ENERGY', 'MISSILE'];
      return ['BALLISTIC', 'ENERGY', 'MISSILE'].includes(weapon.type) ? [weapon.type] : [];
    }),
  );
  return weaponTypeColor(
    types.size === 3 || !types.size
      ? 'UNIVERSAL'
      : types.size === 1
        ? [...types][0]!
        : !types.has('MISSILE')
          ? 'HYBRID'
          : !types.has('ENERGY')
            ? 'COMPOSITE'
            : 'SYNERGY',
  );
}
export const groupDialogHeight = (count: number): number => 650 - 21 * (24 - Math.max(15, Math.min(24, count)));
export const groupTableHeight = (count: number): number => 23 + 21 * Math.max(15, Math.min(24, count));
