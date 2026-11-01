import type { RowData, ResourceRef, FileVersion } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { mountedWeaponImages, type MountedWeaponImages } from '@/shared/lib/starsector/weapon-images';
import { rendersLoadedMissiles } from '@/shared/lib/starsector/weapon-render-order';

export interface ShipWeaponSource {
  spec: RowData | null;
  resources: Record<string, ResourceRef>;
  projectile: RowData;
  projectileResources: Record<string, ResourceRef>;
  diagnostic: string;
}
export interface ShipWeaponSources {
  baseVersions: FileVersion[];
  hints: string[];
  weapons: Record<string, ShipWeaponSource>;
  diagnostic: string;
}
export interface ShipMountedWeapon extends MountedWeaponImages {
  slotIndex: number;
  weaponId: string;
}

export function shipBuiltInWeaponIds(ship: Readonly<RowData>): string[] {
  return [
    ...new Set(
      Object.values(isRowData(ship.builtInWeapons) ? ship.builtInWeapons : {}).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ];
}

export function projectShipWeapons(
  ship: Readonly<RowData>,
  sources: ShipWeaponSources,
): { weapons: ShipMountedWeapon[]; diagnostics: string[] } {
  const weapons: ShipMountedWeapon[] = [];
  const diagnostics: string[] = sources.diagnostic ? [sources.diagnostic] : [];
  const slots = Array.isArray(ship.weaponSlots) ? ship.weaponSlots.filter(isRowData) : [];
  for (const [slotId, value] of Object.entries(isRowData(ship.builtInWeapons) ? ship.builtInWeapons : {})) {
    const id = str(value),
      label = `槽位 ${slotId} · 武器 ${id || '（空引用）'}`;
    const slotIndex = slots.findIndex((slot) => slot.id === slotId),
      slot = slots[slotIndex];
    const source = sources.weapons[id];
    if (!id) {
      diagnostics.push(label + '：武器引用为空或无效');
      continue;
    }
    if (!slot) {
      diagnostics.push(label + '：槽位缺失');
      continue;
    }
    if (!source) continue;
    if (!source.spec) {
      diagnostics.push(label + '：' + (source.diagnostic || '武器规格缺失'));
      continue;
    }
    const images = mountedWeaponImages(source.spec, source.resources, source.projectile, source.projectileResources, slot, sources.hints);
    weapons.push({ ...images, slotIndex, weaponId: id });
    const mode = slot.mount === 'HARDPOINT' ? 'hardpoint' : 'turret';
    if (slot.mount !== 'HIDDEN' && !source.resources[mode + 'Sprite']) diagnostics.push(label + '：' + mode + 'Sprite 贴图引用缺失');
    if (source.spec.specClass === 'projectile' && rendersLoadedMissiles(source.spec, slot.mount === 'HIDDEN') && !images.loadedMissile)
      diagnostics.push(label + '：已装载导弹的贴图、尺寸、中心或发射点来源缺失');
    if (arr(slot.locations).length < 2) diagnostics.push(label + '：槽位位置缺失');
  }
  return { weapons, diagnostics };
}
