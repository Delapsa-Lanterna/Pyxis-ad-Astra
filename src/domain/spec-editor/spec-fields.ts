import type { FieldSchema } from '@/domain/schema/schema.types';
import type { RowData, JsonValue } from '@/shared/types';
export type SpecField = FieldSchema;

export type SpecSection = { name: string; title: string; fields: SpecField[] };

export function specFieldParent(content: RowData, path: string, create = false): { parent: RowData; key: string } {
  const keys = path.replaceAll('[', '.').replaceAll(']', '').split('.');
  const key = keys.pop()!;
  const parent = keys.reduce((value, part, index) => {
    const next = value[part] ?? (create && /^\d+$/.test(keys[index + 1] ?? key) ? [0, 0] : {});
    if (create) value[part] = next;
    return next as RowData;
  }, content);
  return { parent, key };
}

export function updateSpecField(content: RowData, path: string, value: JsonValue | undefined) {
  const { parent, key } = specFieldParent(content, path, value !== undefined);
  if (value === undefined) delete parent[key];
  else parent[key] = value;
}
