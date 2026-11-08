import { schemaFieldIssues } from '@/domain/schema/schema-validation';
import { schemaFieldRequired } from '@/domain/schema/schema-values';
import { specFieldParent, type SpecField } from '@/domain/spec-editor/spec-fields';
import type { FieldProblem, RowData } from '@/shared/types';
export type SpecIssue = FieldProblem;
export function specFieldsIssues(fields: readonly SpecField[], content: RowData, prefix = ''): SpecIssue[] {
  return fields.flatMap((field) => {
    const { parent, key } = specFieldParent(content, field.key);
    return schemaFieldIssues(
      { ...field, required: schemaFieldRequired(field, (key) => content[key] ?? fields.find((item) => item.key === key)?.default) },
      parent[key],
      prefix + field.key,
      false,
      content,
    );
  });
}
