import type { CsvColumnSchema, FieldSchema } from './schema.types';
import { convertSchemaScalarInput } from './schema-values';

export function parseCsvValue(
  column: CsvColumnSchema,
  raw: string,
): { kind: 'empty' } | { kind: 'value'; raw: string; value: string | number | boolean } | { kind: 'error'; message: string } {
  const error = (message: string) => ({ kind: 'error' as const, message });
  if (raw === '') return column.required ? error('必填字段不能为空') : { kind: 'empty' };
  if (column.options) {
    const values =
      column.control === 'tags'
        ? raw
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [raw];
    const invalid = values.filter((entry) => !column.options!.includes(entry));
    if (invalid.length) return error(`值不在允许范围内：${invalid.join('、')}`);
  }
  if (column.control === 'boolean')
    return /^(true|false)$/i.test(raw) ? { kind: 'value', raw, value: raw.toLowerCase() === 'true' } : error('请输入 true 或 false');
  if (column.control === 'number') {
    const parsed = convertSchemaScalarInput(raw, {
      key: column.key,
      label: column.label ?? column.key,
      type: 'float',
      numberFormat: 'starsector',
    });
    if (parsed.kind === 'error') return parsed;
    if (parsed.kind === 'remove') return error('请输入完整有效数字');
    const number = Number(raw.trim().replace(/[fFdD]$/, ''));
    if (!Number.isFinite(number)) return error('请输入有限数字');
    if (column.valueType === 'integer' && (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647))
      return error('请输入 32 位有符号整数范围内的整数');
    return { kind: 'value', raw, value: number };
  }
  return { kind: 'value', raw, value: raw };
}

export function csvValueError(column: CsvColumnSchema, raw: string): string | null {
  const parsed = parseCsvValue(column, raw);
  return parsed.kind === 'error' ? parsed.message : null;
}

export function csvFieldSchema(column: CsvColumnSchema): FieldSchema {
  return {
    ...column,
    label: column.label ?? column.key,
    type:
      column.control === 'number'
        ? (column.valueType ?? 'float')
        : column.control === 'boolean'
          ? 'boolean'
          : column.options || column.source
            ? 'enum'
            : 'string',
    numberFormat: 'starsector',
  };
}
