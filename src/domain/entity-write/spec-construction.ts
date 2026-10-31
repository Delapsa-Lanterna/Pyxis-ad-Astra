import defaults from '../../../schemas/spec-defaults.json';
import type { RowData, WeaponSpecClass, ProjectileSpecClass } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
export function createShipSpec(id: string, hullName = id): RowData {
  return { ...deepClone(defaults.ship), hullId: id, hullName };
}

export function createSystemSpec(id: string): RowData {
  return { ...deepClone(defaults.system), id };
}

export function createSkillSpec(id: string): RowData {
  return { ...deepClone(defaults.skill), id };
}

export function fillRequiredFields(content: RowData, template: RowData, required: readonly string[]): RowData {
  const next = deepClone(content);
  for (const key of required) if (!(key in next)) next[key] = deepClone(template[key]!);
  return next;
}

export function createSpecObject(key: keyof typeof defaults.objects): RowData {
  return deepClone(defaults.objects[key]);
}
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
export function createProjectileSpec(id: string, specClass: ProjectileSpecClass = 'projectile'): RowData {
  return { ...deepClone(defaults.projectile[specClass]), id };
}

const PROJECTILE_REQUIRED_FIELDS: Record<ProjectileSpecClass, readonly string[]> = {
  projectile: ['spawnType', 'collisionClass', 'collisionClassByFighter', 'width', 'fadeTime'],
  missile: ['missileType', 'sprite', 'size', 'center', 'collisionRadius', 'collisionClass', 'engineSpec'],
};

export function changeProjectileSpecClass(content: RowData, specClass: ProjectileSpecClass): RowData {
  const next = fillRequiredFields(content, defaults.projectile[specClass], PROJECTILE_REQUIRED_FIELDS[specClass]);
  if (specClass === 'missile') {
    const engine = next.engineSpec as RowData;
    next.engineSpec = fillRequiredFields(engine, defaults.projectile.missile.engineSpec, ['turnAcc', 'turnRate', 'acc', 'dec']);
  }
  next.specClass = specClass;
  return next;
}
export function createDefaultVariant(hullId: string, variantId: string): RowData {
  return {
    variantId,
    hullId,
    displayName: variantId,
    goalVariant: false,
    fluxVents: 0,
    fluxCapacitors: 0,
    hullMods: [],
    permaMods: [],
    sMods: [],
    weaponGroups: [],
    wings: [],
  };
}

export function createDefaultSkin(baseHullId: string, skinHullId: string): RowData {
  return {
    skinHullId,
    baseHullId,
    hullName: skinHullId,
    tags: [],
    removeHints: [],
    addHints: [],
    removeBuiltInMods: [],
    builtInMods: [],
    removeBuiltInWeapons: [],
    removeWeaponSlots: [],
    removeEngineSlots: [],
    builtInWeapons: {},
    builtInWings: [],
    weaponSlotChanges: {},
    engineSlotChanges: {},
  };
}
