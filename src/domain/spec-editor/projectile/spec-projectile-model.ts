import defaults from '../../../../schemas/spec-defaults.json';
import { fillRequiredFields } from '@/domain/editors/spec-construction';
import { deepClone, str, arr, num } from '@/shared/lib/starsector';
import type { ProjectileSpecClass, RowData } from '@/shared/types';
import { nextFormattedId } from '@/shared/lib/next-formatted-id';
import type { Point } from '@/domain/editors/editor-types';

export function createProjectileEngineSlot(slots: RowData[]): RowData {
  const id = nextFormattedId(new Set(slots.map((slot) => str(slot.id))), (index) => `ES${index}`);
  return {
    id,
    loc: [0, 0],
    angle: 180,
    width: 8,
    length: 20,
    style: 'CUSTOM',
    styleSpec: {
      mode: 'QUAD_STRIP',
      engineColor: [255, 145, 75, 255],
      contrailColor: [100, 100, 100, 150],
      contrailDuration: 0.5,
      contrailWidthMult: 2,
      contrailMaxSpeedMult: 0,
      contrailAngularVelocityMult: 0.5,
      type: 'SMOKE',
    },
  };
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
export function normalizeProjectileSpec(projectile: RowData): RowData {
  const normalized = deepClone(projectile);
  normalized.engineSlots = Array.isArray(normalized.engineSlots) ? normalized.engineSlots : [];
  return normalized;
}

export function projectProjectileGeometry(spec: RowData) {
  const kind = str(spec.specClass, 'projectile');
  const size = arr(spec.size, [10, 20]),
    center = arr(spec.center, [5, 10]);
  const body =
    kind === 'missile'
      ? { x: -center[1]!, y: -center[0]!, width: size[1]!, height: size[0]! }
      : { x: -num(spec.length, 10) / 2, y: -num(spec.width, 3.5) / 2, width: num(spec.length, 10), height: num(spec.width, 3.5) };
  const engines =
    kind === 'missile'
      ? (spec.engineSlots as RowData[]).map((slot) => {
          const loc = arr(slot.loc, [0, 0]);
          return {
            style: slot.style,
            styleSpec: slot.styleSpec,
            point: { x: loc[0]!, y: -loc[1]! },
            angle: num(slot.angle, 180),
            width: num(slot.width, 8),
            length: num(slot.length, 20),
          };
        })
      : [];
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
    kind,
    body,
    size,
    center,
    radius,
    engines,
    spriteField: kind === 'missile' ? 'sprite' : 'bulletSprite',
    spritePath: str(spec[kind === 'missile' ? 'sprite' : 'bulletSprite']),
    fringeColor: arr(spec.fringeColor, [255, 255, 255, 255]),
    coreColor: arr(spec.coreColor, [255, 255, 255, 255]),
    extent: { x: Math.max(...points.map((p) => Math.abs(p.x))), y: Math.max(...points.map((p) => Math.abs(p.y))) },
  };
}
export type ProjectileGeometry = ReturnType<typeof projectProjectileGeometry>;
