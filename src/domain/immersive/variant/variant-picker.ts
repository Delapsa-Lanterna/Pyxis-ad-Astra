import type { RowData } from '@/shared/types';
import { schemaStringValue } from '@/domain/schema/schema-values';

export const VARIANT_CARD_HEIGHT = 75;
export const VARIANT_CARD_STEP = VARIANT_CARD_HEIGHT + 3;
export const WEAPON_FILTER_TYPES: Readonly<Record<string, readonly string[]>> = {
  BALLISTIC: ['BALLISTIC'],
  ENERGY: ['ENERGY'],
  MISSILE: ['MISSILE'],
  HYBRID: ['BALLISTIC', 'ENERGY'],
  SYNERGY: ['ENERGY', 'MISSILE'],
  COMPOSITE: ['BALLISTIC', 'MISSILE'],
  UNIVERSAL: ['BALLISTIC', 'ENERGY', 'MISSILE'],
};
export function weaponFilterDefaults(slot: Readonly<RowData>): { types: string[]; sizes: string[] } {
  const type = schemaStringValue(slot.type),
    size = schemaStringValue(slot.size);
  return {
    types: [...WEAPON_FILTER_TYPES[type]!],
    sizes: ['BALLISTIC', 'ENERGY', 'MISSILE'].includes(type)
      ? { SMALL: ['SMALL'], MEDIUM: ['SMALL', 'MEDIUM'], LARGE: ['MEDIUM', 'LARGE'] }[size]!
      : [size],
  };
}
export function weaponFilterMatches(spec: Readonly<RowData>, types: readonly string[], sizes: readonly string[]): boolean {
  const mountType = schemaStringValue(spec.mountTypeOverride || spec.type);
  return (WEAPON_FILTER_TYPES[mountType] ?? []).some((type) => types.includes(type)) && sizes.includes(schemaStringValue(spec.size));
}
