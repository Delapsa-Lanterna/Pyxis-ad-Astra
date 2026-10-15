import { variantModuleEntries } from '@/domain/config/config-entities';
import type { JsonValue, RowData, JointHullProjection, JointEditSnapshot, JointValue } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';

export type HullmodCategory = 'normal' | 'permanent' | 's';
export function isSystemWeapon(csv: Readonly<RowData>, spec: Readonly<RowData>): boolean {
  return (
    schemaStringValue(csv.hints)
      .split(',')
      .some((hint) => hint.trim() === 'SYSTEM') ||
    (Array.isArray(spec.aiHints) && spec.aiHints.includes('SYSTEM'))
  );
}
export function variantBranchKeys(snapshot: JointEditSnapshot, values: Readonly<Record<string, JointValue>>, key: string): string[] {
  const keys = new Set<string>(),
    pending = [key];
  while (pending.length) {
    const current = pending.shift()!;
    if (keys.has(current)) continue;
    keys.add(current);
    for (const [, id] of variantModuleEntries(jointObject(values[current]).modules)) {
      const record = snapshot.records.find(
        (item) => item.target.kind === 'spec' && item.target.target.kind === 'variant' && item.target.target.id === id,
      );
      if (record && values[record.key]?.state === 'present') pending.push(record.key);
    }
  }
  return [...keys];
}
export function stripVariant(data: Readonly<RowData>, hull: JointHullProjection): RowData {
  const groups = variantWeaponGroups(data)
    .map((group) => ({
      ...group,
      weapons: Object.fromEntries(
        Object.entries(isRowData(group.weapons) ? group.weapons : {}).filter(([slot]) => Object.hasOwn(hull.builtInWeapons, slot)),
      ),
    }))
    .filter((group) => Object.keys(group.weapons).length);
  const result: RowData = { ...data };
  if (Array.isArray(data.weaponGroups)) result.weaponGroups = groups;
  for (const field of ['fluxCapacitors', 'fluxVents']) if (Object.hasOwn(data, field)) result[field] = 0;
  if (Array.isArray(data.wings)) result.wings = data.wings.map((id, index) => (hull.builtInWings[index] ? id : ''));
  for (const field of ['hullMods', 'permaMods', 'sMods'])
    if (Array.isArray(data[field])) result[field] = data[field].filter((id) => typeof id === 'string' && hull.builtInMods.includes(id));
  return result;
}
export function variantWeaponGroups(data: Readonly<RowData>): RowData[] {
  return Array.isArray(data.weaponGroups) ? data.weaponGroups.filter(isRowData) : [];
}
export function equipVariantWeapon(data: Readonly<RowData>, slotId: string, weaponId: string): RowData {
  const groups = deepClone(variantWeaponGroups(data));
  const index = groups.findIndex((group) => isRowData(group.weapons) && Object.hasOwn(group.weapons, slotId));
  for (const group of groups) if (isRowData(group.weapons)) delete group.weapons[slotId];
  if (weaponId) {
    if (!groups.length) groups.push({ mode: 'LINKED', autofire: false, weapons: {} });
    const group = groups[index < 0 ? 0 : index]!;
    group.weapons = { ...(isRowData(group.weapons) ? group.weapons : {}), [slotId]: weaponId };
  }
  return { ...data, weaponGroups: groups };
}
export function moveVariantWeapon(data: Readonly<RowData>, slotId: string, destination: number): RowData {
  const groups = deepClone(variantWeaponGroups(data));
  let weapon: JsonValue | undefined;
  for (const group of groups)
    if (isRowData(group.weapons) && Object.hasOwn(group.weapons, slotId)) {
      weapon = group.weapons[slotId];
      delete group.weapons[slotId];
    }
  if (weapon !== undefined)
    groups[destination]!.weapons = { ...(isRowData(groups[destination]!.weapons) ? groups[destination]!.weapons : {}), [slotId]: weapon };
  return { ...data, weaponGroups: groups };
}
export function equipVariantWing(data: Readonly<RowData>, index: number, id: string): RowData {
  const wings = Array.isArray(data.wings) ? [...data.wings] : [];
  while (wings.length <= index) wings.push('');
  wings[index] = id;
  return { ...data, wings };
}
export function setVariantHullmod(data: Readonly<RowData>, id: string, category: HullmodCategory | null): RowData {
  const result: RowData = { ...data };
  for (const field of ['hullMods', 'permaMods', 'sMods'])
    result[field] = (Array.isArray(data[field]) ? data[field] : []).filter((item) => item !== id);
  if (category) (result.hullMods as JsonValue[]).push(id);
  if (category === 'permanent' || category === 's') (result.permaMods as JsonValue[]).push(id);
  if (category === 's') (result.sMods as JsonValue[]).push(id);
  return result;
}

export function weaponSlotCompatibility(slot: Readonly<RowData>, weapon: Readonly<RowData>): string {
  const ranks: Record<string, number> = { SMALL: 1, MEDIUM: 2, LARGE: 3 };
  const allowed: Record<string, string[]> = {
    BALLISTIC: ['BALLISTIC', 'HYBRID', 'COMPOSITE', 'UNIVERSAL'],
    ENERGY: ['ENERGY', 'HYBRID', 'SYNERGY', 'UNIVERSAL'],
    MISSILE: ['MISSILE', 'COMPOSITE', 'SYNERGY', 'UNIVERSAL'],
    HYBRID: ['HYBRID', 'BALLISTIC', 'ENERGY', 'UNIVERSAL'],
    COMPOSITE: ['COMPOSITE', 'BALLISTIC', 'MISSILE', 'UNIVERSAL'],
    SYNERGY: ['SYNERGY', 'ENERGY', 'MISSILE', 'UNIVERSAL'],
    UNIVERSAL: ['UNIVERSAL', 'BALLISTIC', 'ENERGY', 'MISSILE', 'HYBRID', 'COMPOSITE', 'SYNERGY'],
  };
  const reasons: string[] = [];
  const mountType = String(weapon.mountTypeOverride || weapon.type),
    sameType = slot.type === mountType;
  const compatibleType =
    allowed[String(slot.type)]?.includes(mountType) &&
    (sameType || weapon.restrictToSpecifiedMountType !== true) &&
    !(Array.isArray(weapon.aiHints) && weapon.aiHints.includes('SYSTEM'));
  if (!compatibleType) reasons.push('挂载类型不兼容');
  if ((ranks[String(weapon.size)] ?? Infinity) > (ranks[String(slot.size)] ?? 0)) reasons.push('武器尺寸超过槽位');
  else if (sameType && (ranks[String(weapon.size)] ?? 0) < (ranks[String(slot.size)] ?? 0) - 1) reasons.push('同类型武器只能缩小一级挂载');
  else if (compatibleType && !sameType && ranks[String(weapon.size)] !== ranks[String(slot.size)])
    reasons.push('混合挂载要求武器与槽位尺寸一致');
  return reasons.join('；');
}
