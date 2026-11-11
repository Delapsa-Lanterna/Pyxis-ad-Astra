import type { JointEditSnapshot, JointEditRecord, JointHull, RowData, JsonValue, FieldProblem } from '@/shared/types';
import { composeJson } from '@/domain/json-composition';
import { hullFieldValue } from './hull-fields';
import { isRowData } from '@/shared/lib/row-data';
import { normalizeFsPath } from '@/shared/lib/paths';
import { variantModuleEntries } from '@/shared/lib/starsector/variant-modules';
import { jointObject } from '@/domain/joint-edit';

export function immersiveSourceRecords(snapshot: JointEditSnapshot): {
  spec: JointEditRecord;
  csv: JointEditRecord;
  description: JointEditRecord;
} {
  const spec = snapshot.records.find((record) => record.key === snapshot.bindings.spec)!;
  return {
    spec,
    csv: snapshot.records.find((record) => record.key === snapshot.bindings.csv)!,
    description: snapshot.records.find((record) => record.key === snapshot.bindings.description)!,
  };
}

export function immersiveEditableRecords(snapshot: JointEditSnapshot): string[] {
  if (snapshot.root.kind === 'variant') return variantEditableRecords(snapshot);
  if (snapshot.root.kind === 'wing' || snapshot.root.kind === 'skin') {
    return [
      ...new Set([
        snapshot.bindings.csv!,
        ...[
          snapshot.bindings.variant,
          snapshot.bindings.hull,
          snapshot.bindings.spec,
          snapshot.bindings.hullCsv,
          snapshot.bindings.description,
        ].filter((key): key is string => Boolean(key)),
        ...(snapshot.hull?.skinKeys ?? []),
        ...Object.values(snapshot.hull?.fields ?? {}).flatMap((inputs) => inputs.map((field) => field.recordKey)),
      ]),
    ];
  }
  return Object.values(immersiveSourceRecords(snapshot)).map((record) => record.key);
}

export function variantEditableRecords(snapshot: JointEditSnapshot): string[] {
  const root = snapshot.bindings.variant ?? snapshot.bindings.spec!;
  const keys = new Set([root]);
  const pending = [root];
  while (pending.length) {
    const key = pending.pop()!;
    const data = jointObject(snapshot.records.find((record) => record.key === key)?.value);
    for (const [, id] of variantModuleEntries(data.modules)) {
      const target = snapshot.records.find(
        (record) => record.target.kind === 'spec' && record.target.target.kind === 'variant' && record.target.target.id === id,
      );
      if (target && !keys.has(target.key)) {
        keys.add(target.key);
        pending.push(target.key);
      }
    }
  }
  return [...keys];
}

export function immersiveUsedRecords(snapshot: JointEditSnapshot): JointEditRecord[] {
  const records = new Map(snapshot.records.map((record) => [record.key, record]));
  const identities = new Map(
    snapshot.records.map((record) => [
      record.target.kind === 'spec'
        ? JSON.stringify([record.target.target.kind, record.target.target.id])
        : record.target.kind === 'csv'
          ? JSON.stringify([record.target.table, record.target.identity.id, record.target.identity.type])
          : record.key,
      record,
    ]),
  );
  const used = new Set<JointEditRecord>(),
    pending: JointEditRecord[] = [];
  const data = new Map<string, RowData>();
  const content = (record: JointEditRecord) => {
    if (!data.has(record.key)) data.set(record.key, composeJson(jointObject(record.value) as RowData, record.composition));
    return data.get(record.key)!;
  };
  const add = (record: JointEditRecord | undefined) => {
    if (record && !used.has(record)) {
      used.add(record);
      pending.push(record);
    }
  };
  const entity = (kind: string, id: JsonValue | undefined) => add(identities.get(JSON.stringify([kind, id])));
  const csv = (table: string, id: JsonValue | undefined, type?: string) => add(identities.get(JSON.stringify([table, id, type])));
  const hulls = new Map(Object.values(snapshot.variants).map((hull) => [hull.variantKey, hull]));
  if (snapshot.hull) hulls.set(snapshot.hull.variantKey, snapshot.hull);
  const addHull = (hull: JointHull) => {
    for (const key of [
      hull.hullKey,
      ...hull.skinKeys,
      ...Object.values(hull.displayBindings),
      ...Object.values(hull.fields).flatMap((fields) => fields.map((field) => field.recordKey)),
    ])
      add(records.get(key));
    const variant = content(records.get(hull.variantKey)!);
    for (const slot of hull.slots.filter(isRowData)) entity('weapon', hull.weapons[String(slot.id)]);
    const wings = Array.isArray(variant.wings) ? variant.wings : [];
    for (let i = 0; i < Math.max(wings.length, hull.builtInWings.length); i++) csv('wings', hull.builtInWings[i] || wings[i]);
    for (const id of hull.builtInMods) csv('hullmods', id);
    for (const field of ['hullMods', 'permaMods', 'sMods'])
      for (const id of Array.isArray(variant[field]) ? variant[field] : []) csv('hullmods', id);
    for (const module of hull.modules) add(records.get(module.variantKey));
    for (const fields of Object.values(hull.fields)) for (const field of fields) content(records.get(field.recordKey)!);
    entity('system', hullFieldValue(hull.fields['system id'], data));
    if (hullFieldValue(hull.fields['shield type'], data) === 'PHASE')
      entity('system', hullFieldValue(hull.fields['defense id'], data) || 'phasecloak');
  };
  for (const [binding, key] of Object.entries(snapshot.bindings)) if (binding !== 'projectile') add(records.get(key));
  if (snapshot.hull) addHull(snapshot.hull);
  while (pending.length) {
    const record = pending.pop()!,
      target = record.target,
      value = content(record);
    if (target.kind === 'csv' && target.table === 'wings') entity('variant', value.variant);
    if (target.kind !== 'spec') continue;
    const { kind, id } = target.target;
    if (kind === 'variant') {
      const hull = hulls.get(record.key);
      if (hull && hull !== snapshot.hull) addHull(hull);
    }
    if (kind === 'weapon' || kind === 'system') {
      csv(kind === 'weapon' ? 'weapons' : 'shipSystems', id);
      csv('descriptions', id, kind === 'weapon' ? 'WEAPON' : 'SHIP_SYSTEM');
    }
    if (kind === 'weapon' && value.specClass !== 'beam') entity('projectile', value.projectileSpecId);
  }
  return [...used];
}

export function immersiveRecordProblems(records: readonly JointEditRecord[], issues: readonly FieldProblem[]): FieldProblem[] {
  const paths = new Map<string, Set<string | undefined>>();
  for (const record of records) {
    const write = record.target.kind === 'spec' ? record.target.target.write : record.target.write;
    for (const path of [write.path, record.source?.path, ...(record.composition?.layers.map((layer) => layer.source.path) ?? [])]) {
      if (!path) continue;
      const key = normalizeFsPath(path),
        rows = paths.get(key) ?? new Set<string | undefined>();
      rows.add(record.target.kind === 'csv' ? record.target.rowKey : undefined);
      paths.set(key, rows);
    }
  }
  return issues.filter((issue) => {
    if (!issue.location?.path || issue.code === 'field.input_invalid') return true;
    const rows = paths.get(normalizeFsPath(issue.location.path));
    return Boolean(rows && (!issue.location.rowKey || rows.has(undefined) || rows.has(issue.location.rowKey)));
  });
}
