import { schemaFieldIssues } from '@/domain/schema/schema-validation';
import { schemaFieldRequired } from '@/domain/schema/schema-values';
import { specFieldParent } from '@/domain/spec-editor/spec-fields';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { FieldProblem, RowData } from '@/shared/types';
export function specFieldsIssues(fields: readonly FieldSchema[], content: RowData, prefix = '', partial = false): FieldProblem[] {
  return fields.flatMap((field) => {
    const { parent, key } = specFieldParent(content, field.key);
    return schemaFieldIssues(
      { ...field, required: schemaFieldRequired(field, (key) => content[key] ?? fields.find((item) => item.key === key)?.default) },
      parent[key],
      prefix + field.key,
      partial,
      content,
    );
  });
}
