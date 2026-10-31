import defaults from '../../../schemas/spec-defaults.json';
import type { RowData, WeaponSpecClass } from '@/shared/types';
import { cell, deepClone } from '@/shared/lib/starsector';
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

const PROJECTILE_SCORE_FIELDS = [
  'damage/shot',
  'energy/shot',
  'min spread',
  'max spread',
  'spread/shot',
  'spread decay/sec',
  'proj speed',
  'launch speed',
  'flight time',
  'proj hitpoints',
];
const BEAM_SCORE_FIELDS = ['damage/second', 'energy/second', 'beam speed'];

export function inferWeaponSpecClass(row: RowData): WeaponSpecClass {
  const score = (fields: readonly string[]) => fields.filter((key) => cell(row[key]).trim() !== '').length;
  return score(BEAM_SCORE_FIELDS) > score(PROJECTILE_SCORE_FIELDS) ? 'beam' : 'projectile';
}
