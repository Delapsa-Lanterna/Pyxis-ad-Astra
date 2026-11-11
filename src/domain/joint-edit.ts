import type {
  EditWriteTarget,
  JointEditSnapshot,
  JointEditPrepared,
  JointConflictChoice,
  JointValue,
  JsonValue,
  DeepReadonly,
  RowData,
  EntityIdentityChange,
  CsvRowKeyMapping,
  JointEditRecord,
  FieldProblem,
  ProjectInvalidation,
  JointVariantCatalogKind,
  CsvTableKey,
  EntityKind,
} from '@/shared/types';
import { deepClone, cell } from '@/shared/lib/starsector';
import { AppError } from '@/shared/lib/errors';
import { formatJsonInput } from '@/shared/lib/json-input';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { isRowData } from '@/shared/lib/row-data';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { renameVariantModules } from '@/shared/lib/starsector/variant-modules';
import { composeJson, editComposedJson, takeReplaceBase } from '@/domain/json-composition';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { csvValueError } from '@/domain/schema/csv-value-validation';
import { normalizeFsPath, normalizeRelPath, isAbsoluteFsPath, pathBelongsToRoot } from '@/shared/lib/paths';

export function jointCatalogAffected(invalidation: ProjectInvalidation, kind: JointVariantCatalogKind): boolean {
  if (invalidation.session) return true;
  const tables: Record<JointVariantCatalogKind, CsvTableKey[]> = {
    weapons: ['weapons', 'descriptions'],
    wings: ['wings', 'ships', 'weapons', 'descriptions', 'hullmods', 'shipSystems'],
    hullmods: ['hullmods'],
    variants: ['ships'],
  };
  const entities: Record<JointVariantCatalogKind, EntityKind[]> = {
    weapons: ['weapon', 'projectile'],
    wings: ['ship', 'skin', 'variant', 'weapon', 'projectile', 'system'],
    hullmods: [],
    variants: ['variant', 'ship', 'skin'],
  };
  const roots: Record<JointVariantCatalogKind, string[]> = {
    weapons: ['data/weapons', 'data/shipsystems/wpn', 'data/strings/descriptions.csv'],
    wings: ['data/hulls', 'data/variants', 'data/weapons', 'data/hullmods', 'data/shipsystems', 'data/strings/descriptions.csv'],
    hullmods: ['data/hullmods'],
    variants: ['data/variants', 'data/hulls'],
  };
  return (
    invalidation.tables.some((table) => tables[kind].includes(table)) ||
    invalidation.entities.some((entity) => entities[kind].includes(entity.kind)) ||
    invalidation.paths.some((path) => {
      const changed = `/${normalizeRelPath(path)}`;
      return (
        /(?:^|\/)mod_info\.json$|\/data\/config(?:\/|$)/.test(changed) ||
        roots[kind].some((root) => changed.endsWith(`/${root}`) || changed.includes(`/${root}/`))
      );
    })
  );
}

export function jointSnapshotAffected(snapshot: DeepReadonly<JointEditSnapshot>, invalidation: ProjectInvalidation): boolean {
  if (invalidation.session) return true;
  const paths = [
    ...snapshot.baseVersions.map((version) => version.path),
    ...snapshot.referenceSettings.versions.map((version) => version.path),
    ...snapshot.records.flatMap((record) => [
      record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path,
      ...(record.source ? [record.source.path] : []),
      ...(record.composition?.layers.map((layer) => layer.source.path) ?? []),
    ]),
  ];
  return (
    invalidation.paths.some((path) => {
      const changed = isAbsoluteFsPath(path) ? path : `${snapshot.root.modRoot}/${path}`;
      return paths.some((source) => pathBelongsToRoot(source, changed) || pathBelongsToRoot(changed, source));
    }) ||
    invalidation.entities.some((entity) =>
      snapshot.records.some(
        (record) =>
          record.target.kind === 'spec' &&
          record.target.target.kind === entity.kind &&
          (entity.id === null || record.target.target.id === entity.id),
      ),
    )
  );
}

export function jointProblemBlocks(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
  issue: FieldProblem,
  overrides: readonly string[] = [],
): boolean {
  if (!issue.location?.path || issue.code === 'field.input_invalid' || issue.code === 'write.version_conflict') return true;
  const path = normalizeFsPath(issue.location.path);
  return snapshot.records.some((record) => {
    const write = record.target.kind === 'spec' ? record.target.target.write : record.target.write;
    return (
      normalizeFsPath(write.path) === path &&
      Object.hasOwn(values, record.key) &&
      (record.source?.source === 'mod' || overrides.includes(record.key) || !stableDeepEqual(values[record.key], record.value))
    );
  });
}

export function jointCsvProblems(snapshot: JointEditSnapshot, values: Record<string, JointValue>): FieldProblem[] {
  return snapshot.records.flatMap((record) => {
    const value = values[record.key],
      target = record.target;
    if (target.kind !== 'csv' || value?.state !== 'present') return [];
    const data = jointObject(value);
    return getCsvColumnSchemas(target.table).flatMap((column): FieldProblem[] => {
      const message = csvValueError(column, cell(data[column.key]));
      return message
        ? [
            {
              severity: 'error',
              code: 'csv.value_invalid',
              path: JSON.stringify([record.key, column.key]),
              message: `${target.table} / ${Object.values(target.identity).join(' / ')} / ${column.key}：${message}`,
              location: { rowKey: target.rowKey, field: column.key, path: target.write.path, line: null, column: null },
            },
          ]
        : [];
    });
  });
}

export function jointObject(value: DeepReadonly<JointValue> | undefined): Readonly<RowData> {
  return value?.state === 'present' && isRowData(value.value) ? value.value : {};
}

/** Effective record content: composed records include their same-path base layers. */
export function jointEffectiveObject(snapshot: JointEditSnapshot, values: Readonly<Record<string, JointValue>>, key: string): RowData {
  const data = jointObject(values[key]) as RowData;
  const composition = snapshot.records.find((record) => record.key === key)?.composition;
  return composition ? composeJson(data, composition) : data;
}

/** Applies a transform of the effective record content and keeps only the local difference in the draft. */
export function transformJointRecord(
  snapshot: JointEditSnapshot,
  values: Readonly<Record<string, JointValue>>,
  key: string,
  transform: (data: Readonly<RowData>) => RowData,
): { value: JointValue; notice: string | null } {
  const composition = snapshot.records.find((record) => record.key === key)?.composition;
  if (!composition) return { value: { state: 'present', value: transform(jointObject(values[key])) }, notice: null };
  const local = jointObject(values[key]) as RowData,
    before = composeJson(local, composition);
  const edit = editComposedJson(local, before, transform(before), composition);
  if (edit.rejected) throw new AppError(edit.notice!, { action: 'update-joint-record', code: 'json.replace_unsupported' });
  return { value: { state: 'present', value: edit.value }, notice: edit.notice };
}

/** Removes local replacement markers and returns the record files whose save must join the `replace` list. */
export function takeJointReplaceBase(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
): { values: Record<string, JointValue>; replacePaths: string[] } {
  const result = { ...values },
    replacePaths: string[] = [];
  for (const record of snapshot.records) {
    const value = result[record.key];
    if (record.target.kind !== 'spec' || value?.state !== 'present' || !isRowData(value.value)) continue;
    const taken = takeReplaceBase(value.value);
    if (!taken.replace) continue;
    result[record.key] = { state: 'present', value: taken.value };
    replacePaths.push(record.target.target.write.relPath);
  }
  return { values: result, replacePaths };
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
  changes: readonly EntityIdentityChange[],
  keyMap: readonly CsvRowKeyMapping[],
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
  records: Array<Pick<JointEditRecord, 'key' | 'target'>>;
}

export function rebaseJointDraft(
  values: Record<string, JointValue>,
  before: JointEditSnapshot,
  after: JointEditSnapshot,
  changes: readonly EntityIdentityChange[],
  keyMap: readonly CsvRowKeyMapping[],
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
