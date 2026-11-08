import type { FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import {
  convertSchemaScalarInput,
  getNestedValue,
  schemaFieldRequired,
  schemaFieldVisible,
  schemaFieldVariant,
  schemaKeyValueEntries,
} from '@/domain/schema/schema-values';
import type { FieldProblem, RowData } from '@/shared/types';
import { isEntityId, entityIdInvalidMessage } from '@/domain/schema/schema-identity';

export function schemaFieldIssues(
  field: FieldSchema,
  value: unknown,
  path = field.key,
  partial = false,
  root: RowData = value as RowData,
): FieldProblem[] {
  if (value === undefined && !schemaFieldVisible(field.visibleWhen, root)) return [];
  const fail = (message: string, rule = 'field_invalid'): FieldProblem[] => [
    {
      severity: 'error',
      code: field.issueCode ?? `spec.${rule}`,
      path,
      message: `${field.label || field.key} (${path}): ${field.issueMessage ?? message}`,
    },
  ];
  if (value === undefined) return field.required && !partial ? fail('必填字段未设置') : [];
  if (field.variants) {
    const variant = schemaFieldVariant(field, value);
    if (variant.type === 'json' && !field.variants.some((candidate) => candidate.type === 'json')) return fail('内容类型不符合字段定义');
    return schemaFieldIssues(variant, value, path, partial, root);
  }
  if (field.required && !partial && typeof value === 'string' && !value.trim()) return fail('必填字段不能为空');
  if (field.type === 'json') return [];
  if (value === null) return fail('内容类型不符合字段定义');
  if (!field.required && value === '' && ['string', 'text', 'enum', 'path', 'path-image'].includes(field.type)) return [];
  if (field.type === 'object') {
    if (typeof value !== 'object' || (Array.isArray(value) && field.format !== 'array-of-entries')) return fail('应为对象');
    const entries = schemaKeyValueEntries(value, field.format),
      content = Object.fromEntries(entries.map(({ key, val }) => [key, val]));
    if (
      Array.isArray(value) &&
      value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 1)
    )
      return fail('每个条目应包含一个键值');
    const complete = !partial;
    const shape = [
      ...((field.minEntries !== undefined && entries.length < field.minEntries) ||
      (field.maxEntries !== undefined && entries.length > field.maxEntries)
        ? fail('条目数量不符合要求', 'entry_count')
        : []),
      ...(complete && field.exclusiveKeys && field.exclusiveKeys.filter((key) => Object.hasOwn(content, key)).length !== 1
        ? fail('应设置一个互斥字段', 'exclusive_keys')
        : []),
    ];
    const errors = (field.nested ?? []).flatMap((child) =>
      schemaFieldIssues(
        {
          ...child,
          required: schemaFieldRequired(child, (key) => content[key] ?? field.nested?.find((item) => item.key === key)?.default),
        },
        content[child.key],
        `${path}[${JSON.stringify(child.key)}]`,
        partial,
        root,
      ),
    );
    return [
      ...shape,
      ...errors,
      ...(field.allowExtraFields && field.valueSchema
        ? entries
            .filter(({ key }) => !field.nested?.some((child) => child.key === key))
            .flatMap(({ key, val }) => {
              const childPath = `${path}[${JSON.stringify(key)}]`;
              return [
                ...(field.reservedKeys?.includes(key) ? fail('名称为保留名称', 'reserved_key') : []),
                ...(field.keySchema ? schemaFieldIssues(field.keySchema, key, childPath, false, root) : []),
                ...schemaFieldIssues(field.valueSchema!, val, childPath, !complete, root),
              ];
            })
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
    return field.item ? value.flatMap((item, index) => schemaFieldIssues(field.item!, item, `${path}[${index}]`, partial, root)) : [];
  }
  if (field.type === 'float' || field.type === 'integer') {
    if (typeof value !== 'number' && typeof value !== 'string') return fail('应为数字');
    const result = convertSchemaScalarInput(String(value), field);
    return result.kind === 'set' ? [] : fail(result.kind === 'error' ? result.message : '请输入完整有效数字');
  }
  if (field.type === 'boolean')
    return typeof value === 'boolean' || ['true', 'false'].includes(String(value).toLowerCase()) ? [] : fail('应为布尔值');
  if (typeof value !== 'string') return fail('应为字符串');
  if (field.identity && !isEntityId(value)) return fail(entityIdInvalidMessage(field.label));
  return field.type === 'enum' && field.options?.length && !field.options.includes(value) ? fail('值不在允许范围内') : [];
}
export function schemaDocumentIssues(schema: FileSchema, content: RowData, partial = false): FieldProblem[] {
  const fields = schema.root
    ? [schema.root]
    : (schema.sections ?? []).flatMap((section) =>
        section.fields.map((field) => ({
          ...field,
          required: schemaFieldVisible(section.visibleWhen, content) && field.required,
          requiredWhen: schemaFieldVisible(section.visibleWhen, content) ? field.requiredWhen : undefined,
        })),
      );
  return fields.flatMap((field) => {
    const value = getNestedValue(content, field.key);
    const required = schemaFieldRequired(field, (key) => getNestedValue(content, key) ?? fields.find((item) => item.key === key)?.default);
    return schemaFieldIssues({ ...field, required }, value, field.key, partial, content);
  });
}
