import type { JsonInputShape, RowData } from '@/shared/types';
import type { FieldSchema, FileSchema, SchemaFieldUpdate, SchemaVisibility } from './schema.types';
import { readGameInteger, readGameNumber, prepareSchemaValue, prepareValue, generatedTarget } from './game-number';
import type { PreparedFileValue } from '@/shared/types';
import { pathBasename } from '@/shared/lib/paths';
import { deepClone } from '@/shared/lib/starsector';

export interface SchemaKeyValueEntry {
  key: string;
  val: unknown;
}
export const schemaCollection = (field: FieldSchema) => field.type === 'object' || field.type === 'array';
export function schemaFieldVisible(condition: SchemaVisibility | undefined, content: RowData): boolean {
  return (
    !condition ||
    (Array.isArray(condition) ? condition : [condition]).some((branch) =>
      Object.entries(branch).every(([key, expected]) => {
        const value = getNestedValue(content, key);
        return Array.isArray(expected) ? expected.includes(String(value)) : Number(value) > expected.gt;
      }),
    )
  );
}
export function schemaFieldRequired(field: FieldSchema, read: (key: string) => unknown): boolean {
  return (
    Boolean(field.required) ||
    Boolean(
      field.requiredWhen &&
      Object.entries(field.requiredWhen).every(([key, expected]) => {
        const value = read(key);
        return typeof expected === 'string'
          ? value === expected
          : 'min' in expected
            ? typeof value === 'number' && value >= expected.min
            : value === undefined;
      }),
    )
  );
}
export function schemaInitialValue(field: FieldSchema): unknown {
  if (field.default !== undefined) return deepClone(field.default);
  switch (field.type) {
    case 'object':
      return field.format === 'array-of-entries' ? [] : {};
    case 'array':
    case 'string-array':
    case 'tag-select':
      return [];
    case 'integer':
    case 'float':
      return field.min ?? 0;
    case 'boolean':
      return false;
    case 'json':
      return null;
    default:
      return field.options?.[0] ?? '';
  }
}
export function schemaStringValue(value: unknown): string {
  return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export const schemaArrayStringValues = (value: unknown): string[] => (Array.isArray(value) ? value.map(schemaStringValue) : []);
function objectTags(value: unknown): value is Record<string, unknown> & { tags: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'tags' in value;
}
export function schemaTagValues(value: unknown): string[] {
  return schemaArrayStringValues(objectTags(value) ? value.tags : value);
}
export function wrapSchemaTagValues(value: unknown, tags: string[]): unknown {
  return objectTags(value) ? { ...value, tags } : tags;
}
export function schemaPlainBooleanText(value: unknown): string {
  return schemaStringValue(value);
}
export function parseSchemaPlainBoolean(raw: string): boolean | string {
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return raw;
}
export function parseSchemaPlainNumber(raw: string, integer: boolean): number | string {
  const value = integer ? readGameInteger(raw) : readGameNumber(raw);
  return value === null ? raw : value;
}
export function convertSchemaScalarInput(raw: string, field: FieldSchema): SchemaFieldUpdate | { kind: 'error'; message: string } {
  const error = (message: string) => ({ kind: 'error' as const, message });
  if (field.identity && raw === '') return { kind: 'remove' };
  if (['string', 'text', 'enum', 'path', 'path-image'].includes(field.type)) {
    if (field.required && !raw.trim()) return error('必填字段不能为空');
    return field.reservedKeys?.includes(raw) ? error('名称为保留名称') : { kind: 'set', value: raw };
  }
  if (!raw.trim()) return field.required ? error('必填字段不能为空') : { kind: 'remove' };
  const value = field.type === 'boolean' ? parseSchemaPlainBoolean(raw) : parseSchemaPlainNumber(raw, field.type === 'integer');
  if (typeof value === 'string') return error(field.type === 'boolean' ? '请输入有效布尔值' : '请输入完整有效数字');
  if (typeof value === 'number' && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)))
    return error('数值超出字段允许范围');
  return { kind: 'set', value };
}
function matches(field: FieldSchema, value: unknown): boolean {
  switch (field.type) {
    case 'json':
      return true;
    case 'array':
    case 'string-array':
    case 'tag-select':
    case 'color-rgb':
    case 'color-rgba':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && (!Array.isArray(value) || field.format === 'array-of-entries');
    case 'integer':
    case 'float':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return typeof value === 'string';
  }
}
export function schemaFieldVariant(field: FieldSchema, value: unknown): FieldSchema {
  const variant = field.variants?.find((candidate) => matches(candidate, value ?? field.default));
  return variant || value === undefined
    ? { ...field, ...(variant ?? field.variants?.[0]), variants: undefined }
    : { key: field.key, label: field.label, type: 'json' };
}
function parts(key: string): string[] {
  return [...key.matchAll(/(?:^|\.)([^.[\]]+)|\[("(?:[^"\\]|\\.)*"|\d+)\]/g)].map(
    (match) => match[1] ?? (match[2]!.startsWith('"') ? String(JSON.parse(match[2]!)) : match[2]!),
  );
}
export function prepareSchemaAtPath(value: unknown, path: string[], schema: FileSchema): PreparedFileValue {
  const fields = schema.root ? [schema.root] : (schema.sections ?? []).flatMap((section) => section.fields);
  const candidates = fields
    .map((field) => ({ field, path: parts(field.key) }))
    .filter((candidate) => candidate.path.every((part, index) => part === path[index]))
    .sort((a, b) => b.path.length - a.path.length);
  const candidate = candidates[0];
  let field: FieldSchema | undefined = candidate?.field;
  for (const key of path.slice(candidate?.path.length ?? 0)) {
    if (!field) break;
    field = field.type === 'array' ? field.item : (field.nested?.find((child) => child.key === key) ?? field.valueSchema);
  }
  if (field) return prepareSchemaValue(value, field);
  if (Array.isArray(value)) {
    const children = value.map((item, index) => prepareSchemaAtPath(item, [...path, String(index)], schema));
    return {
      value: { kind: 'array', value: children.map((child) => child.value) },
      target: { ...generatedTarget(), children: { kind: 'array', items: children.map((child) => child.target) } },
    };
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value).map(([key, value]): [string, PreparedFileValue] => [
      key,
      prepareSchemaAtPath(value, [...path, key], schema),
    ]);
    return {
      value: { kind: 'object', value: fields.map(([key, child]) => [key, child.value]) },
      target: { ...generatedTarget(), children: { kind: 'object', items: fields.map(([key, child]) => [key, child.target]) } },
    };
  }
  return prepareValue(value);
}
export function getNestedValue(data: RowData, key: string): unknown {
  let value: unknown = data;
  for (const part of parts(key)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function updateNested(data: RowData, path: string[], update: SchemaFieldUpdate): RowData {
  const [first, ...rest] = path;
  if (first === undefined) return data;
  const result = Array.isArray(data) ? [...data] : Object.assign(Object.create(null), data);
  if (rest.length) result[first] = updateNested((data[first] ?? {}) as RowData, rest, update);
  else if (update.kind === 'remove') delete result[first];
  else result[first] = update.value;
  return result;
}
export function setNestedValue(data: RowData, key: string, value: unknown): RowData {
  return updateNested(data, parts(key), { kind: 'set', value });
}
export function applySchemaFieldUpdate(data: RowData, key: string, update: SchemaFieldUpdate): RowData {
  return updateNested(data, parts(key), update);
}
export const formatSchemaCommaList = (values: string[]) => values.join(', ');
export const parseSchemaCommaList = (raw: string) =>
  raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
export const schemaPathDisplayLabel = pathBasename;
export function schemaJsonInputShape(field: Pick<FieldSchema, 'type' | 'format'>): JsonInputShape {
  return field.type === 'array' || field.type.startsWith('color-') || field.format === 'array-of-entries' ? 'array' : 'object';
}
export function schemaKeyValueEntries(value: unknown, format: FieldSchema['format']): SchemaKeyValueEntry[] {
  const objects = format === 'array-of-entries' && Array.isArray(value) ? value : [value];
  return objects.flatMap((item): SchemaKeyValueEntry[] =>
    item && typeof item === 'object' && !Array.isArray(item) ? Object.entries(item).map(([key, val]) => ({ key, val })) : [],
  );
}
export function schemaKeyValueOutput(
  entries: SchemaKeyValueEntry[],
  format: FieldSchema['format'],
): Record<string, unknown> | Record<string, unknown>[] {
  return format === 'array-of-entries'
    ? entries.map(({ key, val }) => ({ [key]: val }))
    : Object.assign(Object.create(null), Object.fromEntries(entries.map(({ key, val }) => [key, val])));
}
