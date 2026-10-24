import defaults from '../../../schemas/spec-defaults.json';
import type { RowData, JsonValue } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function createShipSpec(id: string, hullName = id): RowData {
  return { ...deepClone(defaults.ship), hullId: id, hullName };
}

export function createSystemSpec(id: string): RowData {
  return { ...deepClone(defaults.system), id };
}

export function createSkillSpec(id: string): RowData {
  return { ...deepClone(defaults.skill), id };
}

export function fillRequiredFields(content: RowData, template: RowData, required: readonly string[]): RowData {
  const next = deepClone(content);
  for (const key of required) if (!(key in next)) next[key] = deepClone(template[key]!);
  return next;
}

export type SpecField = readonly [
  key: string,
  label: string,
  fallback: JsonValue,
  options?: readonly string[],
  required?: boolean,
  source?: string,
];
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
export function createSpecObject(key: keyof typeof defaults.objects): RowData {
  return deepClone(defaults.objects[key]);
}
