import defaults from '../../../schemas/spec-defaults.json';
import type { RowData, WeaponSpecClass } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { fillRequiredFields } from './spec-construction';

export const WEAPON_SPEC_CLASSES: readonly WeaponSpecClass[] = ['projectile', 'beam'];

export function createWeaponSpec(id: string, specClass: WeaponSpecClass): RowData {
  return { ...deepClone(defaults.weapon[specClass]), id };
}

const WEAPON_REQUIRED_FIELDS: Record<WeaponSpecClass, readonly string[]> = {
  projectile: [
    'type',
    'size',
    'turretSprite',
    'hardpointSprite',
    'turretOffsets',
    'hardpointOffsets',
    'turretAngleOffsets',
    'hardpointAngleOffsets',
    'barrelMode',
    'animationType',
    'projectileSpecId',
  ],
  beam: [
    'type',
    'size',
    'turretSprite',
    'hardpointSprite',
    'turretOffsets',
    'hardpointOffsets',
    'turretAngleOffsets',
    'hardpointAngleOffsets',
    'textureType',
  ],
};
export function changeWeaponSpecClass(content: RowData, specClass: WeaponSpecClass): RowData {
  return { ...fillRequiredFields(content, defaults.weapon[specClass], WEAPON_REQUIRED_FIELDS[specClass]), specClass };
}

export function normalizeWeaponSpec(weapon: RowData): RowData {
  const normalized = deepClone(weapon);
  for (const key of ['turretOffsets', 'hardpointOffsets', 'turretAngleOffsets', 'hardpointAngleOffsets']) {
    normalized[key] = Array.isArray(normalized[key]) ? normalized[key] : [];
  }
  return normalized;
}
