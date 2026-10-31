import type { JsonComposition } from '@/shared/types';
import type { JsonValue, RowData } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { captureSaveEdits } from '@/domain/project/save-edits';
import { deepClone } from '@/shared/lib/starsector';

export function composeJson(local: RowData, composition?: JsonComposition): RowData {
  if (!composition || composition.replace) return local;
  const override = composition.layers.findLast((layer) => layer.replace);
  if (override) return deepClone(override.data);
  const values = [...composition.layers.map((layer) => layer.data), local];
  const result = deepClone(values[0]!);
  for (const source of values.slice(1)) mergeJson(result, source, composition.excluded);
  return result;
}

// LoadingUtils preserves the clear sentinel and stringifies supplemental scalars.
function mergeJson(target: RowData, source: RowData, excluded: string[]) {
  for (const [key, value] of Object.entries(source)) {
    if (excluded.includes(key)) continue;
    if (Array.isArray(value)) {
      const current = target[key] ?? [];
      if (!Array.isArray(current)) throw new AppError(`合并字段 ${key} 需要数组`, { code: 'json.merge_type' });
      const name = key.toLowerCase();
      const replace = value[0] === 'core_clearArray' || (current.length === 4 && /color|button/.test(name)) || name.startsWith('music_');
      target[key] = [...(replace ? [] : current), ...deepClone(value)];
    } else if (value !== null && typeof value === 'object') {
      const current = target[key] ?? {};
      if (typeof current !== 'object' || current === null || Array.isArray(current))
        throw new AppError(`合并字段 ${key} 需要对象`, { code: 'json.merge_type' });
      target[key] = current;
      mergeJson(current, value, excluded);
    } else target[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
}

export function compositionValue(value: RowData, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path) current = current !== null && typeof current === 'object' ? (current as RowData)[key] : undefined;
  return current;
}

export function compositionPath(path: string): string[] {
  return [...path.matchAll(/(?:^|\.)([^.[\]]+)|\[("(?:[^"\\]|\\.)*"|\d+)\]/g)]
    .map((match) => match[1] ?? (match[2]!.startsWith('"') ? (JSON.parse(match[2]!) as string) : match[2]!))
    .filter((key) => key !== '__extra');
}

export function setCompositionValue(local: RowData, path: readonly string[], value: JsonValue | undefined): RowData {
  if (!path.length) return value as RowData;
  const result = deepClone(local);
  let parent = result;
  for (const key of path.slice(0, -1)) parent = (parent[key] ??= {}) as RowData;
  if (value === undefined) delete parent[path.at(-1)!];
  else parent[path.at(-1)!] = value;
  return result;
}

export function compositionOrigin(local: RowData, composition: JsonComposition, path: string[]): string | null {
  const arrayIndex = path.findIndex((key) => /^\d+$/.test(key));
  if (arrayIndex >= 0 && !composition.replace) {
    const parent = path.slice(0, arrayIndex),
      index = Number(path[arrayIndex]);
    const inputs = [
      ...composition.layers.map((layer) => ({
        data: layer.data,
        label: layer.source.source === 'core' ? '原版' : layer.source.root.split(/[/\\]/).at(-1)!,
      })),
      { data: local, label: null },
    ];
    let labels: Array<string | null> = [];
    for (const input of inputs) {
      const value = compositionValue(input.data, parent);
      if (!Array.isArray(value)) continue;
      const name = parent.at(-1)!.toLowerCase();
      if (value[0] === 'core_clearArray' || (labels.length === 4 && /color|button/.test(name)) || name.startsWith('music_')) labels = [];
      labels.push(...value.map(() => input.label));
    }
    return labels[index] ?? null;
  }
  if (composition.replace || compositionValue(local, path) !== undefined) return null;
  const source = composition.layers.findLast((layer) => compositionValue(layer.data, path) !== undefined);
  return source ? (source.source.source === 'core' ? '原版' : source.source.root.split(/[/\\]/).at(-1)!) : null;
}

// Only changed paths become local values; inherited objects stay outside the draft.
export function editComposedJson(local: RowData, before: RowData, after: RowData): RowData {
  let result = local;
  for (const edit of captureSaveEdits(before, after)) {
    if (!edit.path.length) return after;
    let value = edit.kind === 'set' ? edit.value : undefined;
    if (Array.isArray(value)) {
      const previous = compositionValue(before, edit.path);
      const own = compositionValue(local, edit.path);
      const name = edit.path.at(-1)!.toLowerCase();
      const atomic = (Array.isArray(previous) && previous.length === 4 && /color|button/.test(name)) || name.startsWith('music_');
      if (
        Array.isArray(previous) &&
        (!own || (Array.isArray(own) && !own.includes('core_clearArray'))) &&
        stableDeepEqual(value.slice(0, previous.length), previous)
      )
        value = [...(Array.isArray(own) ? own : []), ...value.slice(previous.length)];
      else if (!atomic && Array.isArray(previous) && previous.length && value[0] !== 'core_clearArray')
        value = ['core_clearArray', ...value];
    }
    result = setCompositionValue(result, edit.path, value);
  }
  return result;
}
