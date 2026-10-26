import type { RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';

export function transferVariantWeaponSlots(previous: RowData, next: RowData): RowData {
  if (!Array.isArray(next.weaponGroups)) return next;
  const before = Array.isArray(previous.weaponGroups) ? previous.weaponGroups.filter(isRowData) : [];
  if (next.weaponGroups.length < before.length) return next;
  const groups = next.weaponGroups.filter(isRowData).map((group) => ({ ...group }));
  for (const [index, group] of groups.entries()) {
    if (!isRowData(group.weapons)) continue;
    const original = before[index]?.weapons;
    for (const slot of Object.keys(group.weapons)) {
      if (isRowData(original) && Object.hasOwn(original, slot)) continue;
      for (const [otherIndex, other] of groups.entries()) {
        if (otherIndex === index) continue;
        const source = before[otherIndex]?.weapons;
        if (isRowData(source) && Object.hasOwn(source, slot)) group.weapons = { ...group.weapons, [slot]: source[slot]! };
        if (isRowData(other.weapons) && Object.hasOwn(other.weapons, slot)) {
          other.weapons = { ...other.weapons };
          delete other.weapons[slot];
        }
      }
    }
  }
  return { ...next, weaponGroups: groups };
}
