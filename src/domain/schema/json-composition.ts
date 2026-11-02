import type { JsonComposition } from '@/shared/types';
import type { JsonValue, RowData } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { captureSaveEdits } from '@/domain/project/save-edits';
import { deepClone } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';

// Local-only marker: the object replaces its base layers and keeps the sparse draft it replaced for undo.
export const REPLACE_BASE_KEY = '__replaceBase';
const REPLACE_NOTICE = '已修改继承列表中的已有项，当前文件改为整体取代基础内容；保存时会将路径写入 mod_info.json 的 replace，可撤销。';
const REPLACE_UNSUPPORTED = 'settings.json 不支持整体取代，无法修改继承列表中的已有项。';

function withoutReplaceBase(value: RowData): RowData {
  const rest = { ...value };
  delete rest[REPLACE_BASE_KEY];
  return rest;
}

export function replacesBase(local: JsonValue | undefined): boolean {
  if (!isRowData(local)) return false;
  return (
    Object.hasOwn(local, REPLACE_BASE_KEY) ||
    Object.values(local).some((value) => isRowData(value) && Object.hasOwn(value, REPLACE_BASE_KEY))
  );
}

export function composeJson(local: RowData, composition?: JsonComposition): RowData {
  if (Object.hasOwn(local, REPLACE_BASE_KEY)) return withoutReplaceBase(local);
  if (!composition || composition.replace) return local;
  const override = composition.layers.findLast((layer) => layer.replace);
  if (override) return deepClone(override.data);
  const values = [...composition.layers.map((layer) => layer.data), local];
  const result = deepClone(values[0]!);
  for (const source of values.slice(1)) mergeJson(result, source, composition.excluded);
  return result;
}

// Mirrors LoadingUtils array and object merging; supplemental scalars keep their written type.
function mergeJson(target: RowData, source: RowData, excluded: string[]) {
  for (const [key, value] of Object.entries(source)) {
    if (excluded.includes(key)) continue;
    if (Array.isArray(value)) {
      const current = target[key] ?? [];
      if (!Array.isArray(current)) throw new AppError(`合并字段 ${key} 需要数组`, { code: 'json.merge_type' });
      target[key] = [...(arrayReplaces(key, current, value) ? [] : current), ...deepClone(value)];
    } else if (isRowData(value)) {
      const current = target[key] ?? {};
      if (!isRowData(current)) throw new AppError(`合并字段 ${key} 需要对象`, { code: 'json.merge_type' });
      if (Object.hasOwn(value, REPLACE_BASE_KEY)) target[key] = withoutReplaceBase(deepClone(value));
      else {
        target[key] = current;
        mergeJson(current, value, excluded);
      }
    } else target[key] = value;
  }
}

function arrayReplaces(key: string, current: readonly JsonValue[], value: readonly JsonValue[]) {
  const name = key.toLowerCase();
  return value[0] === 'core_clearArray' || (current.length === 4 && /color|button/.test(name)) || name.startsWith('music_');
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
  if (replacesBase(local)) return null;
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
      if (arrayReplaces(parent.at(-1)!, labels as JsonValue[], value)) labels = [];
      labels.push(...value.map(() => input.label));
    }
    return labels[index] ?? null;
  }
  if (composition.replace || compositionValue(local, path) !== undefined) return null;
  const source = composition.layers.findLast((layer) => compositionValue(layer.data, path) !== undefined);
  return source ? (source.source.source === 'core' ? '原版' : source.source.root.split(/[/\\]/).at(-1)!) : null;
}

/**
 * Converts an edit of the composed value into the local draft. Arrays can only extend inherited items;
 * any other change of inherited array items switches the file object at `root` to whole-file replacement.
 */
export function editComposedJson(
  local: RowData,
  before: RowData,
  after: RowData,
  composition: JsonComposition | undefined,
  root: readonly string[] = [],
  normalize: (value: RowData) => RowData = (value) => value,
): ComposedJsonEdit {
  if (!composition) return { value: after, notice: null, rejected: false };
  const own = compositionValue(local, root);
  if (isRowData(own) && Object.hasOwn(own, REPLACE_BASE_KEY)) {
    // Returning to the content that was replaced restores the sparse draft, so undo leaves replacement mode.
    const restored = setCompositionValue(local, root, own[REPLACE_BASE_KEY] as RowData);
    if (stableDeepEqual(normalize(composeJson(restored, composition)), after)) return { value: restored, notice: null, rejected: false };
    const replaced = { ...(compositionValue(after, root) as RowData), [REPLACE_BASE_KEY]: own[REPLACE_BASE_KEY]! };
    return { value: setCompositionValue(local, root, replaced), notice: null, rejected: false };
  }
  let result = local;
  for (const edit of captureSaveEdits(before, after)) {
    if (!edit.path.length) return { value: after, notice: null, rejected: false };
    let value = edit.kind === 'set' ? edit.value : undefined;
    if (Array.isArray(value)) {
      const inherited = compositionValue(composeJson(setCompositionValue(local, edit.path, undefined), composition), edit.path);
      if (Array.isArray(inherited) && inherited.length && !arrayReplaces(edit.path.at(-1)!, inherited, value)) {
        if (!stableDeepEqual(value.slice(0, inherited.length), inherited)) {
          if (composition.excluded.length) return { value: local, notice: REPLACE_UNSUPPORTED, rejected: true };
          const replaced = { ...(compositionValue(after, root) as RowData), [REPLACE_BASE_KEY]: isRowData(own) ? own : {} };
          return { value: setCompositionValue(local, root, replaced), notice: REPLACE_NOTICE, rejected: false };
        }
        value = value.length > inherited.length ? value.slice(inherited.length) : undefined;
      }
    }
    result = setCompositionValue(result, edit.path, value);
  }
  return { value: result, notice: null, rejected: false };
}

export interface ComposedJsonEdit {
  value: RowData;
  notice: string | null;
  rejected: boolean;
}

/** Removes the local replacement marker and reports whether the save must add the file to `replace`. */
export function takeReplaceBase(value: RowData, root: readonly string[] = []): { value: RowData; replace: boolean } {
  const own = compositionValue(value, root);
  if (!isRowData(own) || !Object.hasOwn(own, REPLACE_BASE_KEY)) return { value, replace: false };
  return { value: setCompositionValue(value, root, withoutReplaceBase(own)), replace: true };
}
