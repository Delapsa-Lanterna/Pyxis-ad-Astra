import { getSchema } from '@/domain/schema/config-schema-registry';

function fieldOptions(schema: string, key: string): readonly string[] {
  return getSchema(schema)!
    .sections!.flatMap((section) => section.fields)
    .find((field) => field.key === key)!.options!;
}

export const PROJECTILE_SPAWN_TYPES = fieldOptions('spec-projectile', 'spawnType');
export const BEAM_TEXTURES = fieldOptions('spec-weapon', 'textureType');
export const COLLISION_CLASSES = fieldOptions('spec-projectile', 'collisionClass');
export const MISSILE_TYPES = fieldOptions('spec-projectile', 'missileType');
export const SYSTEM_TYPES = fieldOptions('spec-system', 'type');
