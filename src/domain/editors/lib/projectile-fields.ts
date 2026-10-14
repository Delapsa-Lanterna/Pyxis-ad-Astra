import defaults from '../../../../schemas/spec-defaults.json';
import { fillRequiredFields } from '../spec-construction';
import { deepClone } from '@/shared/lib/starsector';
import type { ProjectileSpecClass, RowData } from '@/shared/types';
import { str } from '@/shared/lib/starsector';
import { nextFormattedId } from '@/shared/lib/next-formatted-id';

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
