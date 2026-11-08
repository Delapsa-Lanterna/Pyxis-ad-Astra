import type { FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';

const CONFIG_SCHEMAS: Record<string, FileSchema> = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('../../../schemas/*.schema.json', { eager: true, import: 'default' })).map(([path, asset]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -'.schema.json'.length);
    return [id, parseFileSchema(id, asset)];
  }),
);

function resolve(field: FieldSchema): FieldSchema {
  if (field.ref) {
    const [id, pointer] = field.ref.split('#/');
    let target: unknown = CONFIG_SCHEMAS[id!];
    for (const key of pointer!.split('/')) target = Reflect.get(target as object, key);
    const own = { ...field };
    delete own.ref;
    field = { ...resolve(target as FieldSchema), ...own };
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
for (const schema of Object.values(CONFIG_SCHEMAS)) {
  if (schema.root) schema.root = resolve(schema.root);
  for (const section of schema.sections ?? []) section.fields = section.fields.map(resolve);
  if (schema.definitions)
    schema.definitions = Object.fromEntries(Object.entries(schema.definitions).map(([key, field]) => [key, resolve(field)]));
}

export function getSchema(id: string): FileSchema | null {
  return Object.hasOwn(CONFIG_SCHEMAS, id) ? CONFIG_SCHEMAS[id]! : null;
}
