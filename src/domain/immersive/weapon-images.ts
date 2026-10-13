import type { RowData, ResourceRef, JsonValue } from '@/shared/types';
import {
  WEAPON_SPRITE_DRAW_ORDER,
  WEAPON_SPRITE_ORIGIN_RATIO,
  weaponOffsetsKey,
  weaponAnglesKey,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';
export interface WeaponImageLayer {
  resource: ResourceRef;
  origin: { x: number; y: number };
}
export interface LoadedWeaponMissile {
  resource: ResourceRef;
  size: [number, number];
  center: [number, number];
  offsets: number[];
  angles: number[];
}
export function weaponImageLayers(
  spec: Readonly<RowData>,
  resources: Record<string, ResourceRef>,
  mode: WeaponViewMode,
): WeaponImageLayer[] {
  const hints = Array.isArray(spec.renderHints) ? spec.renderHints : [];
  const order = hints.includes('RENDER_BARREL_BELOW')
    ? [mode + 'UnderSprite', mode + 'GunSprite', mode + 'Sprite']
    : WEAPON_SPRITE_DRAW_ORDER[mode].filter((field) => !field.endsWith('GlowSprite'));
  return order.flatMap((field) => (resources[field] ? [{ resource: resources[field]!, origin: WEAPON_SPRITE_ORIGIN_RATIO[mode] }] : []));
}
export function weaponLoadedMissile(
  spec: Readonly<RowData>,
  projectile: Readonly<RowData>,
  resources: Record<string, ResourceRef>,
  mode: WeaponViewMode,
): LoadedWeaponMissile | null {
  const hints = Array.isArray(spec.renderHints) ? spec.renderHints : [];
  const visible = hints.some((hint) => hint === 'RENDER_LOADED_MISSILES' || hint === 'RENDER_LOADED_MISSILES_UNLESS_HIDDEN');
  const pair = (value: JsonValue | undefined): [number, number] | null =>
    Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number' ? [value[0], value[1]] : null;
  const size = pair(projectile.size),
    center = pair(projectile.center),
    source = spec[weaponOffsetsKey(mode)],
    directions = spec[weaponAnglesKey(mode)];
  const offsets = Array.isArray(source) ? source.filter((value): value is number => typeof value === 'number') : [];
  const angles = Array.isArray(directions) ? directions.filter((value): value is number => typeof value === 'number') : [];
  return visible && resources.sprite && size && center && offsets.length
    ? { resource: resources.sprite, size, center, offsets, angles }
    : null;
}
