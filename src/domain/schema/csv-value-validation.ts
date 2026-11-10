import type { CsvColumnSchema, FieldSchema } from './schema.types';
import { convertSchemaScalarInput } from './schema-values';

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
  };
}
export function parseCsvValue(
  column: CsvColumnSchema,
  raw: string,
): { kind: 'empty' } | { kind: 'value'; raw: string; value: string | number | boolean } | { kind: 'error'; message: string } {
  if (!raw) return column.required ? { kind: 'error', message: '必填字段不能为空' } : { kind: 'empty' };
  const parsed = convertSchemaScalarInput(raw, csvFieldSchema(column));
  if (parsed.kind === 'error') return parsed;
  if (parsed.kind === 'remove') return { kind: 'empty' };
  const value = parsed.value;
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean')
    throw new Error('CSV scalar schema produces a scalar');
  if (column.valueType === 'integer' && typeof value === 'number' && (value < -2147483648 || value > 2147483647))
    return { kind: 'error', message: '请输入 32 位有符号整数范围内的整数' };
  if (
    column.options &&
    (column.control === 'tags'
      ? raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [raw]
    ).some((v) => !column.options!.includes(v))
  )
    return { kind: 'error', message: '值不在允许范围内' };
  return { kind: 'value', raw, value };
}
export function csvValueError(column: CsvColumnSchema, raw: string): string | null {
  const result = parseCsvValue(column, raw);
  return result.kind === 'error' ? result.message : null;
}
export function prepareCsvValue(column: CsvColumnSchema, raw: string): string {
  const parsed = parseCsvValue(column, raw);
  if (parsed.kind === 'error') throw new Error(parsed.message);
  if (parsed.kind === 'empty') return '';
  if (column.control === 'number') {
    const value = parsed.value as number;
    const text = String(value);
    return column.valueType === 'integer' || /[.eE]/.test(text) ? text : `${text}.0`;
  }
  return typeof parsed.value === 'boolean' ? String(parsed.value) : raw;
}
