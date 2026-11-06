import type { CsvColumnSchema } from './schema.types';
import { convertSchemaScalarInput } from './schema-values';

export function csvValueError(column: CsvColumnSchema, value: string): string | null {
  if (value === '') return column.required ? '必填字段不能为空' : null;
  if (column.options) {
    const values =
      column.control === 'tags'
        ? value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [value];
    const invalid = values.filter((entry) => !column.options!.includes(entry));
    if (invalid.length) return `值不在允许范围内：${invalid.join('、')}`;
  }
  if (column.control === 'boolean' && !/^(true|false)$/i.test(value)) return '请输入 true 或 false';
  if (column.control === 'number') {
    const parsed = convertSchemaScalarInput(value, {
      key: column.key,
      label: column.label ?? column.key,
      type: 'float',
      numberFormat: 'starsector',
    });
    if (parsed.kind === 'error') return parsed.message;
    const number = Number(value.trim().replace(/[fFdD]$/, ''));
    if (!Number.isFinite(number)) return '请输入有限数字';
    if (column.valueType === 'integer' && (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647))
      return '请输入 32 位有符号整数范围内的整数';
  }
  return null;
}
