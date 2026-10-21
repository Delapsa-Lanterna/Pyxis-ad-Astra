import type {
  EditWriteTarget,
  JointEditSnapshot,
  JointEditPrepared,
  JointConflictChoice,
  JointValue,
  JsonValue,
  DeepReadonly,
  RowData,
} from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { formatJsonInput } from '@/shared/lib/json-input';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { isRowData } from '@/shared/lib/row-data';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { renameVariantModules } from '@/domain/json-editor/json-variant-modules';

export function jointObject(value: DeepReadonly<JointValue> | undefined): Readonly<RowData> {
  return value?.state === 'present' && isRowData(value.value) ? value.value : {};
}

export function conflictValueText(value: JointValue): string {
  return value.state === 'missing' ? '字段不存在' : value.value === null ? 'null' : formatJsonInput(value.value, 'json');
}

export function jointWriteTargets(snapshot: JointEditSnapshot, recordKeys?: readonly string[]): EditWriteTarget[] {
  const records = recordKeys ? snapshot.records.filter((record) => recordKeys.includes(record.key)) : snapshot.records;
  const paths = new Set(
    (recordKeys ? records.flatMap((record) => record.baseVersions) : snapshot.baseVersions).map((version) => version.path),
  );
  for (const record of records) paths.add(record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path);
  return [...paths].map((path) => ({ sessionId: snapshot.root.sessionId, modRoot: snapshot.root.modRoot, path }));
}

export function mapJointDraftIdentity(
  values: Record<string, JointValue>,
  before: JointIdentitySnapshot,
  after: JointEditSnapshot,
  changes: readonly import('@/shared/types').EntityIdentityChange[],
  keyMap: readonly import('@/shared/types').CsvRowKeyMapping[],
): Record<string, JointValue> {
  const mapped: Record<string, JointValue> = Object.create(null);
  for (const previous of before.records) {
    if (!Object.hasOwn(values, previous.key)) continue;
    const target = previous.target;
    let value = values[previous.key]!;
    let next = after.records.find((record) => record.key === previous.key);
    const binding = Object.entries(before.bindings).find(([, key]) => key === previous.key)?.[0];
    if (binding) next = after.records.find((record) => record.key === after.bindings[binding]);
    if (target.kind === 'spec') {
      const change = changes.find((change) => change.before.kind === target.target.kind && change.before.id === target.target.id);
      if (change) {
        if (!binding)
          next = after.records.find(
            (record) =>
              record.target.kind === 'spec' &&
              record.target.target.kind === change.after.kind &&
              record.target.target.id === change.after.id,
          );
        const field = entityContentIdField(change.after.kind);
        const nextId = next?.target.kind === 'spec' ? next.target.target.id : change.after.id;
        if (
          value.state === 'present' &&
          value.value !== null &&
          typeof value.value === 'object' &&
          !Array.isArray(value.value) &&
          value.value[field] === change.before.id
        )
          value = { state: 'present', value: { ...value.value, [field]: nextId } };
      }
    } else if (target.kind === 'csv') {
      const key = keyMap.find((mapping) => mapping.previousKey === target.rowKey)?.nextKey ?? target.rowKey;
      next = binding
        ? next
        : (after.records.find(
            (record) => record.target.kind === 'csv' && record.target.table === target.table && record.target.rowKey === key,
          ) ?? next);
      if (
        next?.target.kind === 'csv' &&
        value.state === 'present' &&
        value.value !== null &&
        typeof value.value === 'object' &&
        !Array.isArray(value.value)
      ) {
        const data = { ...value.value };
        for (const [field, id] of Object.entries(next.target.identity)) if (data[field] === target.identity[field]) data[field] = id;
        value = { state: 'present', value: data };
      }
    }
    if (target.kind === 'spec' && target.target.kind === 'variant' && value.state === 'present' && isRowData(value.value)) {
      let data = value.value;
      for (const change of changes)
        if (change.before.kind === 'variant' && change.before.id !== change.after.id)
          data = renameVariantModules(data, change.before.id, change.after.id);
      value = { state: 'present', value: data };
    }
    mapped[next?.key ?? previous.key] = value;
  }
  return mapped;
}

export interface JointIdentitySnapshot {
  bindings: Record<string, string>;
  records: Array<Pick<import('@/shared/types').JointEditRecord, 'key' | 'target'>>;
}

export function rebaseJointDraft(
  values: Record<string, JointValue>,
  before: JointEditSnapshot,
  after: JointEditSnapshot,
  changes: readonly import('@/shared/types').EntityIdentityChange[],
  keyMap: readonly import('@/shared/types').CsvRowKeyMapping[],
  baselineValues: Record<string, JointValue> = Object.fromEntries(before.records.map((record) => [record.key, record.value])),
): Record<string, JointValue> {
  const mapped = mapJointDraftIdentity(values, before, after, changes, keyMap);
  const base = mapJointDraftIdentity(baselineValues, before, after, changes, keyMap);
  for (const record of after.records) {
    if (Object.hasOwn(mapped, record.key)) mapped[record.key] = rebaseValue(base[record.key]!, mapped[record.key]!, record.value);
  }
  return mapped;
}

function rebaseValue(base: JointValue, local: JointValue, current: JointValue): JointValue {
  if (stableDeepEqual(base, local)) return deepClone(current);
  if (
    base.state === 'present' &&
    local.state === 'present' &&
    current.state === 'present' &&
    isRowData(base.value) &&
    isRowData(local.value) &&
    isRowData(current.value)
  ) {
    const data = deepClone(current.value);
    for (const key of new Set([...Object.keys(base.value), ...Object.keys(local.value)])) {
      const field = (value: RowData): JointValue =>
        Object.hasOwn(value, key) ? { state: 'present', value: value[key]! } : { state: 'missing' };
      const next = rebaseValue(field(base.value), field(local.value), field(current.value));
      if (next.state === 'missing') delete data[key];
      else Object.defineProperty(data, key, { value: next.value, enumerable: true, writable: true, configurable: true });
    }
    return { state: 'present', value: data };
  }
  return deepClone(local);
}

export function applyJointConflictChoices(prepared: JointEditPrepared, choices: JointConflictChoice[]): Record<string, JointValue> {
  const values = deepClone(prepared.values);
  const byField = new Map(choices.map((choice) => [JSON.stringify([choice.recordKey, choice.path]), choice]));
  for (const conflict of prepared.conflicts) {
    const choice = byField.get(JSON.stringify([conflict.recordKey, conflict.path]))!;
    const selected = choice.choice === 'draft' ? conflict.draft : conflict.disk;
    if (conflict.path.length === 0) {
      values[conflict.recordKey] = deepClone(selected);
      continue;
    }
    const record = values[conflict.recordKey]!;
    if (record.state === 'present') {
      let object = record.value as Record<string, JsonValue>;
      for (const key of conflict.path.slice(0, -1)) object = object[key] as Record<string, JsonValue>;
      const key = conflict.path.at(-1)!;
      if (selected.state === 'missing') delete object[key];
      else Object.defineProperty(object, key, { value: deepClone(selected.value), enumerable: true, writable: true, configurable: true });
    }
  }
  return values;
}
