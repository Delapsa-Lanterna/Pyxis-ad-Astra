import type { RowData, ResourceRef, JsonValue } from '@/shared/types';
import {
  weaponSpriteDrawOrder,
  WEAPON_SPRITE_ORIGIN_RATIO,
  weaponOffsetsKey,
  weaponAnglesKey,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';
import { weaponRenderOrder, rendersLoadedMissiles } from './weapon-render-order';
export interface WeaponImageLayer {
  resource: ResourceRef;
  origin: { x: number; y: number };
  phase: 'under' | 'body';
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
  return weaponSpriteDrawOrder(spec, mode).flatMap((field): WeaponImageLayer[] =>
    resources[field]
      ? [{ resource: resources[field]!, origin: WEAPON_SPRITE_ORIGIN_RATIO[mode], phase: field.endsWith('UnderSprite') ? 'under' : 'body' }]
      : [],
  );
}
export function weaponLoadedMissile(
  spec: Readonly<RowData>,
  projectile: Readonly<RowData>,
  resources: Record<string, ResourceRef>,
  mode: WeaponViewMode | 'hidden',
): LoadedWeaponMissile | null {
  const visible = spec.specClass === 'projectile' && rendersLoadedMissiles(spec, mode === 'hidden');
  const pair = (value: JsonValue | undefined): [number, number] | null =>
    Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number' ? [value[0], value[1]] : null;
  const size = pair(projectile.size),
    center = pair(projectile.center),
    source = spec[weaponOffsetsKey(mode === 'hidden' ? 'turret' : mode)],
    directions = spec[weaponAnglesKey(mode === 'hidden' ? 'turret' : mode)];
  let offsets = Array.isArray(source) ? source.filter((value): value is number => typeof value === 'number') : [];
  const angles = Array.isArray(directions) ? directions.filter((value): value is number => typeof value === 'number') : [];
  // BaseWeaponSpec uses half turret offsets for HIDDEN; WeaponSpriteRenderer counts hardpoint offsets.
  if (mode === 'hidden') {
    const count = Array.isArray(spec.hardpointOffsets) ? spec.hardpointOffsets.length : 0;
    offsets = offsets.slice(0, count).map((value) => Math.fround(Math.fround(value) * 0.5));
  }
  return visible && resources.sprite && size && center && offsets.length
    ? { resource: resources.sprite, size, center, offsets, angles }
    : null;
}

export interface MountedWeaponImages {
  slot: Readonly<RowData>;
  renderOrder: number;
  layers: WeaponImageLayer[];
  loadedMissile: LoadedWeaponMissile | null;
  additive: boolean;
}

export function weaponAdditiveBlend(spec: Readonly<RowData>): boolean {
  return spec.specClass !== 'pulse' && Array.isArray(spec.renderHints) && spec.renderHints.includes('RENDER_ADDITIVE');
}

export function mountedWeaponImages(
  spec: Readonly<RowData>,
  resources: Record<string, ResourceRef>,
  projectile: Readonly<RowData>,
  projectileResources: Record<string, ResourceRef>,
  slot: Readonly<RowData>,
  hullHints: readonly string[],
): MountedWeaponImages {
  const hidden = slot.mount === 'HIDDEN';
  const mode = slot.mount === 'HARDPOINT' ? 'hardpoint' : 'turret';
  return {
    slot,
    renderOrder: weaponRenderOrder(spec, slot, hullHints),
    layers: hidden ? [] : weaponImageLayers(spec, resources, mode),
    // MissileWeapon.render permits loaded missiles independently of the hidden body.
    loadedMissile: weaponLoadedMissile(spec, projectile, projectileResources, hidden ? 'hidden' : mode),
    additive: weaponAdditiveBlend(spec),
  };
}
