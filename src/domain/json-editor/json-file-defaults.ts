import type { RowData } from '@/shared/types';

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
