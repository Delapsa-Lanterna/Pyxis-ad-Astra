import type { DiscoveredField, FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import { getExtraFieldSource, getSchemaSections } from '@/domain/schema/schema-sections';

export function mergeSchemaWithCoreFields(schema: FileSchema, discoveredFields: DiscoveredField[]): FileSchema {
  if (!discoveredFields || discoveredFields.length === 0 || schema.root || schema.allowExtraFields !== true) return schema;
  const coreSourceId = getExtraFieldSource(schema) ?? schema.sources?.[0]?.id ?? null;

  const definedFields = new Map<string, FieldSchema>();
  const sections = getSchemaSections(schema);
  function collect(field: FieldSchema, key: string) {
    definedFields.set(coreFieldKey(key, coreSourceId), field);
    for (const child of field.nested ?? []) collect(child, `${key}.${child.key}`);
  }
  for (const section of sections) for (const field of section.fields) collect(field, field.key);

  const newFields: FieldSchema[] = discoveredFields
    .filter(
      (df) =>
        !definedFields.has(df.key) &&
        [...definedFields].every(([key, field]) => !df.key.startsWith(`${key}.`) || field.allowExtraFields === true),
    )
    .map((df) => ({
      key: coreSourceId ? `${coreSourceId}.${df.key}` : df.key,
      type: 'json',
      label: df.key,
      description: '来自 starsector-core（自动发现）',
    }));

  if (newFields.length === 0) return schema;

  return {
    ...schema,
    sections: [
      ...sections,
      {
        id: '__core_discovered',
        label: `来自原版 (${newFields.length})`,
        collapsed: true,
        fields: newFields,
      },
    ],
  };
}

function coreFieldKey(key: string, sourceId: string | null): string {
  return sourceId && key.startsWith(`${sourceId}.`) ? key.slice(sourceId.length + 1) : key;
}
