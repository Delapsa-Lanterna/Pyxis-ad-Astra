import type { RowData } from '@/shared/types';
import { arr, num, str } from '@/shared/lib/starsector';

export function rendersLoadedMissiles(spec: Readonly<RowData>, hidden: boolean): boolean {
  const hints = Array.isArray(spec.renderHints) ? spec.renderHints : [];
  return hints.includes('RENDER_LOADED_MISSILES') || (!hidden && hints.includes('RENDER_LOADED_MISSILES_UNLESS_HIDDEN'));
}

export function weaponRenderOrder(spec: Readonly<RowData>, slot: Readonly<RowData>, hullHints: readonly string[]): number {
  const f = Math.fround;
  const size = ({ SMALL: 0, MEDIUM: 1, LARGE: 2 } as Record<string, number>)[str(spec.size)] ?? 0;
  const base = size * 2 + (slot.mount === 'HARDPOINT' ? 0 : 20);
  // PlasmaWeapon.getRenderOrder uses only size and mount.
  if (spec.specClass === 'pulse') return base;
  const location = arr(slot.locations, [0, 0]);
  const x = f(location[0]!),
    y = f(location[1]!);
  // Utils.getWeaponSlotOrder gives FRONT_TO_BACK precedence when both hints exist.
  const position = hullHints.includes('WEAPONS_FRONT_TO_BACK')
    ? f(f(Math.abs(y) / 50000) + f(x / 10000))
    : hullHints.includes('WEAPONS_BACK_TO_FRONT')
      ? f(f(Math.abs(y) / 50000) - f(x / 10000))
      : f(f(Math.abs(y) / 10000) + Math.abs(f(x / 10000000)));
  const modifier = f(num(slot.renderOrderMod));
  // MissileWeapon/BeamWeapon.getRenderOrder: Below wins; modifiers remain additive.
  if (spec.renderBelowAllWeapons === true) return f(f(0 - position) + modifier);
  // WeaponSpecLoader loads Above only for projectile/pulse, leaving beam false.
  if (spec.specClass === 'projectile' && spec.renderAboveAllWeapons === true) return f(f(100000 - position) + modifier);
  const missile = spec.specClass === 'projectile' && spec.type === 'MISSILE' && rendersLoadedMissiles(spec, slot.mount === 'HIDDEN');
  return f(f(base - (missile ? 1 : 0) - position) + modifier);
}

export function sortMountedWeapons<T extends { slot: Readonly<RowData>; renderOrder: number }>(weapons: readonly T[]): T[] {
  // Ship.addFittedModule compares equal float orders with Java String.compareTo (UTF-16).
  return [...weapons].sort((a, b) => {
    if (a.renderOrder !== b.renderOrder) return Math.sign(a.renderOrder - b.renderOrder);
    const left = str(a.slot.id),
      right = str(b.slot.id);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
