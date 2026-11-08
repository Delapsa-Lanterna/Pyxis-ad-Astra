import { getSchema } from '@/domain/schema/config-schema-registry';
import type { FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import { schemaFieldVisible } from '@/domain/schema/schema-values';
export function specSchema(id: string): FileSchema {
  return getSchema(id)!;
}
export function specSections(id: string, content: RowData) {
  const visible = (condition: FieldSchema['visibleWhen']) => schemaFieldVisible(condition, content);
  return specSchema(id)
    .sections!.filter((section) => visible(section.visibleWhen))
    .map((section) => ({ name: section.id, title: section.label, fields: section.fields.filter((field) => visible(field.visibleWhen)) }));
}
