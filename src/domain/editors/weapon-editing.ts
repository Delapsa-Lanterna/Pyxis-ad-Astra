import type { RowData } from '@/shared/types';
import type { Point, CanvasModifiers, WeaponOperationPreview } from './editor-types';
import { pointAngleScreen } from './lib/geometry';
import { snapToStep } from './lib/editor-constants';
import { findMirrorBarrelIndex, mirrorLateral, mirrorAngleDeg, MIRROR_EPSILON } from './lib/mirror';
import { weaponOffsetsKey, weaponAnglesKey, type WeaponViewMode } from './lib/weapon-sprite-fields';

export function projectWeaponBarrels(weapon: RowData, mode: WeaponViewMode) {
  return { offsets: weapon[weaponOffsetsKey(mode)] as number[], angles: weapon[weaponAnglesKey(mode)] as number[] };
}
export type WeaponOperationKind = 'add' | 'offset' | 'angle';
export function weaponOperationKind(m: CanvasModifiers, selected: number | null): WeaponOperationKind {
  return m.shiftKey ? 'add' : m.ctrlKey && selected !== null ? 'angle' : 'offset';
}
export function previewWeaponOperation(
  weapon: RowData,
  mode: WeaponViewMode,
  selected: number | null,
  m: CanvasModifiers,
  point: Point,
): WeaponOperationPreview {
  const kind = weaponOperationKind(m, selected);
  if (kind === 'add') return { kind, coord: { x: snapToStep(point.x), y: snapToStep(point.y) } };
  if (kind === 'angle') return { kind, angle: weaponBarrelAngle(projectWeaponBarrels(weapon, mode).offsets, selected!, point) };
  return null;
}
export function weaponBarrelAngle(offsets: number[], i: number, point: Point) {
  return pointAngleScreen({ x: offsets[i * 2] || 0, y: offsets[i * 2 + 1] || 0 }, point);
}
export function addWeaponBarrel(weapon: RowData, mode: WeaponViewMode, point: Point, mirror: boolean) {
  const { offsets, angles } = projectWeaponBarrels(weapon, mode),
    i = Math.floor(offsets.length / 2);
  offsets.push(point.x, point.y);
  angles.push(0);
  const paired = mirror && Math.abs(point.y) > MIRROR_EPSILON;
  if (paired) {
    offsets.push(point.x, mirrorLateral(point.y));
    angles.push(0);
  }
  return { i, pair: paired ? i + 1 : null };
}
export function updateWeaponBarrel(
  weapon: RowData,
  mode: WeaponViewMode,
  i: number,
  pair: number | null,
  kind: 'offset' | 'angle',
  point: Point,
) {
  const { offsets, angles } = projectWeaponBarrels(weapon, mode);
  if (kind === 'angle') {
    angles[i] = weaponBarrelAngle(offsets, i, point);
    if (pair !== null) angles[pair] = mirrorAngleDeg(angles[i]!);
  } else {
    const x = snapToStep(point.x),
      y = snapToStep(point.y);
    offsets.splice(i * 2, 2, x, y);
    if (pair !== null) offsets.splice(pair * 2, 2, x, mirrorLateral(y));
  }
}
export function deleteWeaponBarrel(weapon: RowData, mode: WeaponViewMode, i: number, mirror: boolean) {
  const { offsets, angles } = projectWeaponBarrels(weapon, mode),
    pair = mirror ? findMirrorBarrelIndex(offsets, i) : null;
  for (const index of (pair === null ? [i] : [i, pair]).sort((a, b) => b - a)) {
    offsets.splice(index * 2, 2);
    angles.splice(index, 1);
  }
}
