import type { JointEditSnapshot, JointEditRecord, JointEditKind, JointValue, CsvTableKey, EntityKind, RowData } from '@/shared/types';
import { entityContentId } from '@/domain/project/entity-definitions';
import { immersiveEditableRecords } from '@/domain/immersive/source-records';
import { entityTargetFixture } from './entity-target';

export const fixtureCsvPaths: Partial<Record<CsvTableKey, string>> = {
  ships: 'data/hulls/ship_data.csv',
  weapons: 'data/weapons/weapon_data.csv',
  wings: 'data/hulls/wing_data.csv',
  descriptions: 'data/strings/descriptions.csv',
  shipSystems: 'data/shipsystems/ship_systems.csv',
  hullmods: 'data/hullmods/hull_mods.csv',
};

export function fixtureLocation(root: string, relPath: string) {
  return { source: 'mod' as const, root, relPath, path: `${root}/${relPath}` };
}

export function fixtureSpecTarget(kind: EntityKind, data: RowData, root: string) {
  return entityTargetFixture(kind, entityContentId(kind, data), 'existing', root);
}

export function fixtureSpecRecord(key: string, kind: EntityKind, data: RowData): JointEditRecord {
  const target = fixtureSpecTarget(kind, data, 'M:/mod');
  const version = { path: target.write.path, fingerprint: 'fixture-v1' };
  return {
    key,
    target: { kind: 'spec', target },
    source: { ...target.write },
    sourceVersion: version,
    baseVersions: [{ ...version }],
    value: { state: 'present', value: data },
    referencedBy: [],
    resourceRefs: {},
  };
}

export function fixtureCsvRecord(
  key: string,
  table: CsvTableKey,
  identity: Record<string, string>,
  data: RowData,
  rowKey = key,
): JointEditRecord {
  const write = fixtureLocation('M:/mod', fixtureCsvPaths[table]!);
  const version = { path: write.path, fingerprint: 'fixture-v1' };
  return {
    key,
    target: { kind: 'csv', table, rowKey, identity, write },
    source: { ...write },
    sourceVersion: version,
    baseVersions: [{ ...version }],
    value: { state: 'present', value: data },
    referencedBy: [],
    resourceRefs: {},
  };
}

export function fixtureJointSnapshot(
  kind: JointEditKind,
  id: string,
  records: JointEditRecord[],
  bindings: Record<string, string>,
): JointEditSnapshot {
  return {
    root: { sessionId: 's', modRoot: 'M:/mod', kind, id },
    records,
    bindings,
    referenceSettings: { resources: {}, values: {}, versions: [] },
    baseVersions: [...new Map(records.flatMap((record) => record.baseVersions).map((version) => [version.path, version])).values()],
    hull: null,
    variants: {},
    catalog: null,
    newSources: [],
  };
}

export function jointFixtureValues(snapshot: JointEditSnapshot): Record<string, JointValue> {
  const keys = immersiveEditableRecords(snapshot);
  return Object.fromEntries(
    snapshot.records.filter((record) => keys.includes(record.key)).map((record) => [record.key, structuredClone(record.value)]),
  );
}

export function retargetJointFixture(snapshot: JointEditSnapshot): JointEditSnapshot {
  for (const record of snapshot.records) {
    const data = record.value.state === 'present' ? (record.value.value as RowData) : {};
    if (record.target.kind === 'spec') record.target.target = fixtureSpecTarget(record.target.target.kind, data, snapshot.root.modRoot);
    else if (record.target.kind === 'csv') {
      record.target.write = fixtureLocation(snapshot.root.modRoot, fixtureCsvPaths[record.target.table]!);
      record.target.identity = Object.fromEntries(Object.keys(record.target.identity).map((key) => [key, String(data[key])]));
    }
    const location = record.target.kind === 'spec' ? record.target.target.write : record.target.write;
    record.source = { ...location };
    record.sourceVersion = { path: location.path, fingerprint: 'fixture-v1' };
    record.baseVersions = [{ ...record.sourceVersion }];
  }
  snapshot.baseVersions = [...new Map(snapshot.records.flatMap((r) => r.baseVersions).map((v) => [v.path, v])).values()];
  return snapshot;
}
