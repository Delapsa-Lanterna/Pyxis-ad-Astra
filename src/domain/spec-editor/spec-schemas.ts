import { getSchema } from '@/domain/schema/config-schema-registry';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';
import type { FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import { schemaFieldVisible } from '@/domain/schema/schema-values';
const schemas = new Map<string, FileSchema>();
export function specSchema(id: string): FileSchema {
  if (!schemas.has(id)) {
    const asset = getSchema(id)!;
    schemas.set(id, {
      ...asset,
      sections: asset.sections?.map((section) => ({ ...section, fields: section.fields.map(resolve) })),
      definitions: Object.fromEntries(Object.entries(asset.definitions ?? {}).map(([key, field]) => [key, resolve(field)])),
    });
  }
  return schemas.get(id)!;
}
function resolve(field: FieldSchema): FieldSchema {
  if (field.ref) {
    const [id, pointer] = field.ref.split('#/');
    const asset = getSchema(id!)!;
    let value: unknown = asset;
    for (const key of pointer!.split('/')) value = Reflect.get(value as object, key);
    const target = parseFileSchema('reference', { $schema: 'pyxis-ad-astra/field-schema/v1', id: 'reference', root: value }).root!;
    const own = { ...field };
    delete own.ref;
    field = { ...resolve(target), ...own };
  }
  return {
    ...field,
    ...(field.nested ? { nested: field.nested.map(resolve) } : {}),
    ...(field.item ? { item: resolve(field.item) } : {}),
    ...(field.valueSchema ? { valueSchema: resolve(field.valueSchema) } : {}),
    ...(field.variants ? { variants: field.variants.map(resolve) } : {}),
  };
}
export function specSections(id: string, content: RowData) {
  const visible = (condition: FieldSchema['visibleWhen']) => schemaFieldVisible(condition, content);
  return specSchema(id)
    .sections!.filter((section) => visible(section.visibleWhen))
    .map((section) => ({ name: section.id, title: section.label, fields: section.fields.filter((field) => visible(field.visibleWhen)) }));
}
