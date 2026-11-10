import type { FieldSchema, FileSchema } from './schema.types';
import { parseFileSchema } from './schema-asset-parser';

const SOURCES: Record<string, FileSchema> = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('../../../schemas/*.schema.json', { eager: true, import: 'default' })).map(([path, asset]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -'.schema.json'.length);
    return [id, parseFileSchema(id, asset)];
  }),
);

function resolve(field: FieldSchema): FieldSchema {
  if (field.ref) {
    const [id, pointer] = field.ref.split('#/');
    let target: unknown = SOURCES[id!];
    for (const key of pointer!.split('/')) target = Reflect.get(target as object, key);
    const overrides = { ...field };
    delete overrides.ref;
    return resolve({ ...resolve(target as FieldSchema), ...overrides });
  }
  return {
    ...field,
    ...(field.nested ? { nested: field.nested.map(resolve) } : {}),
    ...(field.item ? { item: resolve(field.item) } : {}),
    ...(field.valueSchema ? { valueSchema: resolve(field.valueSchema) } : {}),
    ...(field.keySchema ? { keySchema: resolve(field.keySchema) } : {}),
    ...(field.variants ? { variants: field.variants.map(resolve) } : {}),
  };
}
const SCHEMAS = Object.fromEntries(
  Object.entries(SOURCES).map(([id, schema]) => [
    id,
    {
      ...schema,
      ...(schema.root ? { root: resolve(schema.root) } : {}),
      ...(schema.sections ? { sections: schema.sections.map((section) => ({ ...section, fields: section.fields.map(resolve) })) } : {}),
      ...(schema.definitions
        ? { definitions: Object.fromEntries(Object.entries(schema.definitions).map(([key, field]) => [key, resolve(field)])) }
        : {}),
    },
  ]),
);
export function getSchema(id: string): FileSchema | null {
  return Object.hasOwn(SCHEMAS, id) ? SCHEMAS[id]! : null;
}
