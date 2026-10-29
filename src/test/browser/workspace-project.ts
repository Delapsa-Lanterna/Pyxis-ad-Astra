import type * as T from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { createBrowserModel, sampleRoot } from './scenarios/model';
import { entityTargetFixture } from '../fixtures/entity-target';
import { jsonEntityFixture } from '../fixtures/json-editor';
import { MISC_CONFIG_FILES } from '@/domain/json-editor/misc-config-files';
import { miscConfigFixture } from '../fixtures/misc-config';
import { entityContentId } from '@/domain/project/entity-definitions';
import { fixtureCsvPaths } from '../fixtures/joint-edit/joint-record';
import { createSystemSpec } from '@/domain/editors/spec-construction';

export const gameRoot = 'M:/sample-game';
export const workspaceRoots = ['Atlas', 'Borealis', 'Cygnus'].map((name) => gameRoot + '/mods/' + name);
export const coreRoot = gameRoot + '/starsector-core';

export function createWorkspaceProject(root: string, index: number) {
  const model = createBrowserModel('csv', 4, 'workspace-' + index, 0, root);
  const manifest = model.manifest;
  manifest.modRoot = root;
  manifest.starsectorRoot = gameRoot;
  manifest.coreAvailable = true;
  manifest.modInfo = { id: 'sample_' + index, name: root.split('/').at(-1)!, version: '1.0', description: '完整浏览器测试样本' };
  const tables = new Map(
    TABLE_KEYS.map((table) => {
      const value = createBrowserModel('csv', 4, model.sessionId, 0, root);
      value.manifest.tableSummaries.ships.path = root + '/' + (fixtureCsvPaths[table] ?? `data/campaign/${table}.csv`);
      manifest.tableSummaries[table] = { ...value.manifest.tableSummaries.ships };
      manifest.tableEntitySummaries[table] = value.rows.length;
      return [table, value] as const;
    }),
  );
  const entities = new Map<string, T.EntityData>();
  const textFiles = new Map<string, string>([
    ['notes.txt', 'Browser workspace\n'],
    ['mod_info.json', JSON.stringify(manifest.modInfo, null, 2)],
  ]);
  const versions = new Map<string, string>();
  const entityKey = (kind: T.EntityKind, id: string) => kind + ':' + id;
  function put(entity: T.EntityData) {
    entity.baseVersions = entity.baseVersions.map(({ path }) => ({ path, fingerprint: versions.get(path) ?? '1' }));
    for (const version of entity.baseVersions) versions.set(version.path, version.fingerprint!);
    entities.set(entityKey(entity.kind, entity.id), entity);
    textFiles.set(entity.target.write.path, JSON.stringify(entity.data, null, 2));
  }
  for (const kind of ['ship', 'weapon', 'wing', 'variant', 'skin'] as const) {
    const graph = model.graph(kind);
    for (const record of graph.records) {
      if (record.target.kind !== 'spec' || record.value.state !== 'present') continue;
      const target = structuredClone(record.target.target);
      target.write = { ...target.write, root, path: root + '/' + target.write.relPath };
      target.source = { ...target.write };
      const spec = structuredClone(record.value.value);
      const data =
        target.kind === 'weapon' || target.kind === 'projectile'
          ? { spec, csvRow: { id: target.id, name: target.id, type: 'BALLISTIC' } }
          : spec;
      put({
        kind: target.kind,
        id: target.id,
        target,
        data,
        baseVersions: record.baseVersions.map((version) => ({ ...version, path: root + '/' + version.path.slice(sampleRoot.length + 1) })),
        resourceRefs: record.resourceRefs,
      });
    }
  }
  for (const kind of ['faction', 'mission'] as const) put(jsonEntityFixture(kind, 'sample_' + kind, 'Sample ' + kind, root));
  const systemTarget = entityTargetFixture('system', 'sample_system', 'existing', root);
  put({
    kind: 'system',
    id: 'sample_system',
    target: systemTarget,
    data: createSystemSpec('sample_system'),
    baseVersions: [{ path: systemTarget.write.path, fingerprint: '1' }],
    resourceRefs: {},
  });
  for (const entity of entities.values()) {
    const table = entity.kind === 'ship' ? 'ships' : entity.kind === 'weapon' ? 'weapons' : null;
    if (!table) continue;
    const row = tables.get(table)!.rows[1]!;
    row.data = { ...row.data, id: entity.id, name: entity.id };
    entity.target.linkedRecord = { kind: 'csv', table, rowKey: row.rowKey };
  }
  const variant = [...entities.values()].find((entity) => entity.kind === 'variant')!;
  const ship = [...entities.values()].find((entity) => entity.kind === 'ship')!;
  const variantData = variant.data as T.RowData;
  variantData.hullId = ship.id;
  const slots = [
    { id: 'WS001', type: 'BALLISTIC', size: 'SMALL', mount: 'HARDPOINT' },
    { id: 'WS002', type: 'ENERGY', size: 'MEDIUM', mount: 'TURRET' },
    { id: 'WS003', type: 'MISSILE', size: 'LARGE', mount: 'HIDDEN' },
  ];
  (ship.data as T.RowData).weaponSlots = slots.map((slot, i) => ({ ...slot, angle: 0, locations: [i * 30, 0], arc: 90 }));
  for (const entity of entities.values())
    if (entity.kind === 'variant')
      Object.assign(entity.data as T.RowData, {
        hullId: ship.id,
        weaponGroups: [
          { mode: 'LINKED', weapons: { WS001: 'test_weapon' }, autofire: false },
          { mode: 'LINKED', weapons: {}, autofire: false },
        ],
      });
  for (const entity of entities.values()) put(entity);
  for (const definition of MISC_CONFIG_FILES) {
    const path = root + '/' + definition.path;
    model.miscFiles.push({
      kind: definition.kind,
      path,
      relPath: definition.path,
      data: miscConfigFixture(definition.kind),
      baseVersions: [{ path, fingerprint: '1' }],
    });
  }
  manifest.entitySummaries = {
    ...manifest.entitySummaries,
    ships: 1,
    weapons: 1,
    projectiles: 1,
    variants: 1,
    skins: 1,
    systems: 1,
    factions: 1,
    missions: 1,
  };
  manifest.associatedSpecTables = ['ships', 'weapons', 'wings', 'shipSystems'];
  const history: T.FileHistorySnapshot = { revision: 0, undoStack: [], redoStack: [] };
  let revision = 1;
  const snapshots: { before: T.EntityData[]; after: T.EntityData[] }[] = [];
  function write(value: T.RowData | null, target: T.WriteContentTarget, paths: string[]) {
    revision++;
    paths.forEach((path) => versions.set(path, String(revision)));
    const result = model.receipt(value, target);
    result.baseVersions = paths.map((path) => ({ path, fingerprint: String(revision) }));
    result.invalidation = { ...result.invalidation, session: true, paths };
    result.sessionUpdates[0]!.projection.invalidation = result.invalidation;
    result.history = structuredClone(history);
    return result;
  }
  function saveEntity(target: T.EntityEditTarget, data: T.RowData) {
    const before = structuredClone([...entities.values()]);
    const previous = entities.get(entityKey(target.kind, target.id));
    const id = entityContentId(target.kind, data);
    const nextTarget = entityTargetFixture(target.kind, id, 'existing', root);
    nextTarget.linkedRecord = target.linkedRecord;
    const result = write(data, { kind: 'spec', target: nextTarget }, [nextTarget.write.path]);
    put({ kind: target.kind, id, data, target: nextTarget, baseVersions: result.baseVersions, resourceRefs: previous?.resourceRefs ?? {} });
    if (id !== target.id) entities.delete(entityKey(target.kind, target.id));
    snapshots.push({ before, after: structuredClone([...entities.values()]) });
    return result;
  }
  function undo() {
    const snapshot = snapshots.pop();
    if (!snapshot) return model.receipt(null);
    entities.clear();
    snapshot.before.forEach((entity) => entities.set(entityKey(entity.kind, entity.id), entity));
    return write(
      null,
      { kind: 'json', origin: { kind: 'modInfo' } },
      [...entities.values()].flatMap((entity) => entity.baseVersions.map((version) => version.path)),
    );
  }
  return { model, manifest, tables, entities, textFiles, versions, slots, history, snapshots, put, write, saveEntity, undo, entityKey };
}
export type WorkspaceProject = ReturnType<typeof createWorkspaceProject>;
