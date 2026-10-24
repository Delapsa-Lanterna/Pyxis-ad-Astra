import type { FieldSchema } from '@/domain/schema/schema.types';
import {
  convertSchemaScalarInput,
  schemaFieldRequired,
  schemaFieldVisible,
  schemaFieldVariant,
  schemaKeyValueEntries,
} from '@/domain/schema/schema-values';
import { specFieldParent, type SpecField } from '@/domain/editors/spec-construction';
import type { RowData } from '@/shared/types';
import { isEntityId, entityIdInvalidMessage } from '@/domain/project/entity-definitions';

import type { FieldProblem } from '@/shared/types';
export type SpecIssue = FieldProblem;
export function specFieldIssues(
  field: FieldSchema,
  value: unknown,
  path = field.key,
  partial = false,
  root: RowData = value as RowData,
): SpecIssue[] {
  if (!schemaFieldVisible(field.visibleWhen, root)) return [];
  const fail = (message: string): SpecIssue[] => [
    {
      severity: 'error',
      code: field.issueCode ?? 'spec.field_invalid',
      path,
      message: `${field.label || field.key}（${path}）：${field.issueMessage ?? message}`,
    },
  ];
  if (value === undefined || value === null) return field.required && !partial ? fail('必填字段未设置') : [];
  if (field.variants) {
    const variant = schemaFieldVariant(field, value);
    if (variant.type === 'json' && !field.variants.some((candidate) => candidate.type === 'json')) return fail('内容类型不符合字段定义');
    return specFieldIssues(variant, value, path, partial, root);
  }
  if (field.required && !partial && typeof value === 'string' && !value.trim()) return fail('必填字段不能为空');
  if (field.type === 'json') return [];
  if (!field.required && value === '' && ['string', 'text', 'enum', 'path', 'path-image'].includes(field.type)) return [];
  if (field.type === 'object') {
    if (typeof value !== 'object' || (Array.isArray(value) && field.format !== 'array-of-entries')) return fail('应为对象');
    const entries = schemaKeyValueEntries(value, field.format),
      content = Object.fromEntries(entries.map(({ key, val }) => [key, val]));
    const errors = (field.nested ?? []).flatMap((child) =>
      specFieldIssues(
        {
          ...child,
          required: schemaFieldRequired(child, (key) => content[key] ?? field.nested?.find((item) => item.key === key)?.default),
        },
        content[child.key],
        `${path}[${JSON.stringify(child.key)}]`,
        partial || field.partial,
        root,
      ),
    );
    return [
      ...errors,
      ...(field.allowExtraFields && field.valueSchema
        ? entries
            .filter(({ key }) => !field.nested?.some((child) => child.key === key))
            .flatMap(({ key, val }) => specFieldIssues(field.valueSchema!, val, `${path}[${JSON.stringify(key)}]`, false, root))
        : []),
    ];
  }
  if (['array', 'string-array', 'tag-select', 'color-rgb', 'color-rgba'].includes(field.type)) {
    if (!Array.isArray(value)) return fail('应为列表');
    if (
      (field.minEntries !== undefined && value.length < field.minEntries) ||
      (field.maxEntries !== undefined && value.length > field.maxEntries)
    )
      return fail('条目数量不符合要求');
    if (
      field.type.startsWith('color-') &&
      (value.length !== (field.type === 'color-rgb' ? 3 : 4) ||
        value.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255))
    )
      return fail('颜色通道应为 0 至 255 的整数');
    if (['string-array', 'tag-select'].includes(field.type) && value.some((v) => typeof v !== 'string')) return fail('列表项应为字符串');
    if (
      ['string-array', 'tag-select'].includes(field.type) &&
      field.options?.length &&
      value.some((v) => !field.options!.includes(String(v)))
    )
      return fail('值不在允许范围内');
    return field.item ? value.flatMap((item, index) => specFieldIssues(field.item!, item, `${path}[${index}]`, false, root)) : [];
  }
  if (field.type === 'float' || field.type === 'integer') {
    if (typeof value !== 'number' && typeof value !== 'string') return fail('应为数字');
    const result = convertSchemaScalarInput(String(value), field);
    return result.kind === 'error' ? fail(result.message) : [];
  }
  if (field.type === 'boolean')
    return typeof value === 'boolean' || ['true', 'false'].includes(String(value).toLowerCase()) ? [] : fail('应为布尔值');
  if (typeof value !== 'string') return fail('应为字符串');
  if (field.identity && !isEntityId(value)) return fail(entityIdInvalidMessage(field.label));
  return field.type === 'enum' && field.options?.length && !field.options.includes(value) ? fail('值不在允许范围内') : [];
}
export function specFieldsIssues(fields: readonly SpecField[], content: RowData, prefix = ''): SpecIssue[] {
  return fields.flatMap((field) => {
    const { parent, key } = specFieldParent(content, field.key);
    return specFieldIssues(
      { ...field, required: schemaFieldRequired(field, (key) => content[key] ?? fields.find((item) => item.key === key)?.default) },
      parent[key],
      prefix + field.key,
      false,
      content,
    );
  });
}
