import type { FileSchema } from '@/domain/schema/schema.types';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';

const CONFIG_SCHEMAS: Record<string, FileSchema> = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('../../../schemas/*.schema.json', { eager: true, import: 'default' })).map(([path, asset]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -'.schema.json'.length);
    return [id, parseFileSchema(id, asset)];
  }),
);

export function getSchema(id: string): FileSchema | null {
  return Object.hasOwn(CONFIG_SCHEMAS, id) ? CONFIG_SCHEMAS[id]! : null;
}
