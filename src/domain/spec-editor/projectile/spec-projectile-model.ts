import { createSpecObject } from '@/domain/entity-write/spec-construction';
import { deepClone, str, num } from '@/shared/lib/starsector';
import type { RowData } from '@/shared/types';
import { nextFormattedId } from '@/shared/lib/next-formatted-id';
import type { Point } from '@/domain/editors/editor-types';
import { projectileAppearance } from '@/domain/editors/projectile-appearance';

export function createProjectileEngineSlot(slots: RowData[]): RowData {
  const id = nextFormattedId(new Set(slots.map((slot) => str(slot.id))), (index) => `ES${index}`);
  return {
    id,
    loc: [0, 0],
    angle: 180,
    width: 8,
    length: 20,
    style: 'CUSTOM',
    styleSpec: createSpecObject('styleSpec'),
  };
}
export function normalizeProjectileSpec(projectile: RowData): RowData {
  const normalized = deepClone(projectile);
  normalized.engineSlots = Array.isArray(normalized.engineSlots) ? normalized.engineSlots : [];
  return normalized;
}

export function projectProjectileGeometry(spec: RowData) {
  const appearance = projectileAppearance(spec);
  const kind = str(spec.specClass, 'projectile');
  const size = 'size' in spec ? appearance.size : [0, 0],
    center = 'center' in spec ? appearance.center : [0, 0];
  appearance.size = size;
  appearance.center = center;
  const body =
    kind === 'missile'
      ? { x: -center[1]!, y: -center[0]!, width: size[1]!, height: size[0]! }
      : { x: -appearance.length / 2, y: -appearance.width / 2, width: appearance.length, height: appearance.width };
  const engines = kind === 'missile' ? appearance.engines : [];
  const radius = kind === 'missile' ? num(spec.collisionRadius, 0) : 0;
  const points: Point[] = [
    { x: body.x, y: body.y },
    { x: body.x + body.width, y: body.y + body.height },
    { x: -radius, y: -radius },
    { x: radius, y: radius },
  ];
  for (const engine of engines) {
    const angle = (-engine.angle * Math.PI) / 180;
    for (const x of [0, engine.length])
      for (const y of [-engine.width / 2, engine.width / 2])
        points.push({
          x: engine.point.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: engine.point.y + x * Math.sin(angle) + y * Math.cos(angle),
        });
  }
  return {
    appearance,
    kind,
    body,
    size,
    center,
    radius,
    engines,
    spriteField: kind === 'missile' ? 'sprite' : 'bulletSprite',
    spritePath: str(spec[kind === 'missile' ? 'sprite' : 'bulletSprite']),
    extent: { x: Math.max(...points.map((p) => Math.abs(p.x))), y: Math.max(...points.map((p) => Math.abs(p.y))) },
  };
}
export type ProjectileGeometry = ReturnType<typeof projectProjectileGeometry>;
