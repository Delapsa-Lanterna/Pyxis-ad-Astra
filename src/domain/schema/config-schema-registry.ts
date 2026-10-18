import type { FileSchema } from '@/domain/schema/schema.types';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';
import { MOD_INFO_SCHEMA } from '@/domain/schema/mod-info-schema';
import factionSchemaRaw from '../../../schemas/faction.schema.json';
import missionSchemaRaw from '../../../schemas/mission.schema.json';
import skinSchemaRaw from '../../../schemas/skin.schema.json';
import variantSchemaRaw from '../../../schemas/variant.schema.json';

const CONFIG_SCHEMAS: Record<string, FileSchema> = {
  'mod-info': MOD_INFO_SCHEMA,
  faction: parseFileSchema('faction', factionSchemaRaw),
  mission: parseFileSchema('mission', missionSchemaRaw),
  skin: parseFileSchema('skin', skinSchemaRaw),
  variant: parseFileSchema('variant', variantSchemaRaw),
};

export function getSchema(id: string): FileSchema | null {
  return Object.hasOwn(CONFIG_SCHEMAS, id) ? CONFIG_SCHEMAS[id]! : null;
}
