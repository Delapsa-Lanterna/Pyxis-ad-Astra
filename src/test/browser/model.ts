import type {
  AppSettings,
  CsvRowRecord,
  JointEditKind,
  JointEditRoot,
  JointEditSnapshot,
  JointValue,
  JointVariantCatalogKind,
  JointVariantEntry,
  ManagedWindowContext,
  PerformanceMonitorStatus,
  RowData,
  SaveCsvPatchPayload,
  SaveJointEditPayload,
} from '@/shared/types';
import { createSettingsFixture } from '../settings';
import { sessionUpdateFixture, savedWriteFixture } from '../write-result';
import { shipJointFixture } from '../ship-joint-edit';
import { weaponJointFixture } from '../weapon-joint-edit';
import { wingJointFixture } from '../wing-joint-edit';
import { variantJointFixture } from '../variant-joint-edit';
import { retargetJointFixture, fixtureLocation, fixtureSpecTarget } from '../joint-record';
import { jointObject } from '@/domain/joint-edit';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { variantEditableRecords } from '@/domain/immersive/source-records';

export const scenarioNames = ['settings', 'csv', 'ship', 'weapon', 'wing', 'variant', 'weapons', 'wings', 'hullmods'] as const;
export type BrowserScenario = (typeof scenarioNames)[number];
export const sampleRoot = 'M:/browser-sample';
const builders = { ship: shipJointFixture, weapon: weaponJointFixture, wing: wingJointFixture, variant: variantJointFixture };
let settingsRevision = 0;
let windowRevision = 0;
export const sampleImage =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><path fill="#8db5ce" d="M16 1 28 38 23 45H9L4 38Z"/><path fill="#edf6fc" d="M16 8 19 34H13Z"/></svg>',
  );

export function createBrowserModel(scene: BrowserScenario, count = scene === 'csv' ? 50 : 30, sessionId = 'browser-sample') {
  const header = [
    'id',
    'name',
    'designation',
    'tags',
    'hullSize',
    'fleet pts',
    'base value',
    ...Array.from({ length: 33 }, (_, i) => 'field_' + i),
  ];
  const rows: CsvRowRecord[] =
    scene === 'csv'
      ? Array.from({ length: count }, (_, i) => ({
          rowKey: 'ships:row:' + i,
          isComment: i % 97 === 0,
          data: Object.fromEntries(
            header.map((key) => [
              key,
              key === 'id'
                ? 'ship_' + i
                : key === 'name'
                  ? 'Sample ship ' + i
                  : key === 'tags'
                    ? 'sample,benchmark'
                    : key === 'hullSize'
                      ? 'CRUISER'
                      : String(i),
            ]),
          ),
        }))
      : [];
  const manifest = sessionUpdateFixture(sessionId, sampleRoot).projection.manifest;
  manifest.modInfo = { name: '浏览器样本' };
  manifest.tableSummaries.ships = { path: 'data/hulls/ship_data.csv', header, available: scene === 'csv', totalRows: rows.length };
  const graphs = new Map<string, JointEditSnapshot>();
  const catalogs = new Map<JointVariantCatalogKind, JointVariantEntry[]>();
  const commits = new Map<number, Pick<ReturnType<typeof savedWriteFixture>, 'sessionUpdates'>>();
  let settings = createSettingsFixture(),
    revision = ++settingsRevision,
    commitId = 0,
    nextRow = count,
    reads = 0;
  let context: ManagedWindowContext;
  const failures = new Map<string, string>();
  const monitor: PerformanceMonitorStatus = {
    enabled: false,
    records: 0,
    overwritten: 0,
    startedAt: 0,
    path: '',
    traceAvailable: true,
    traceState: 'idle',
    traceSeconds: 15,
    traceStartedAt: 0,
    traceError: '',
  };

  function graph(kind: JointEditKind, id?: string): JointEditSnapshot {
    const key = kind + ':' + (id ?? 'default');
    if (!graphs.has(key)) {
      const data = builders[kind]();
      data.root = { ...data.root, sessionId, modRoot: sampleRoot };
      if (id) {
        const record = data.records.find((r) => r.key === data.bindings[kind === 'wing' ? 'csv' : 'spec'])!;
        const previousId = data.root.id;
        (record.value as { state: 'present'; value: RowData }).value[kind === 'wing' ? 'id' : entityContentIdField(kind)] = id;
        for (const related of data.records)
          if (related.target.kind === 'csv' && related.target.identity.id === previousId)
            (related.value as { state: 'present'; value: RowData }).value.id = id;
        data.root.id = id;
      }
      for (const record of data.records) {
        if (record.target.kind === 'spec') {
          const data = (record.value as { state: 'present'; value: RowData }).value;
          if (record.target.target.kind === 'ship') {
            data.spriteName = 'graphics/sample.svg';
            data.width ??= 200;
            data.height ??= 360;
            data.center ??= [100, 180];
          }
          for (const field of Object.keys(data).filter((key) => key.endsWith('Sprite') || key === 'spriteName'))
            record.resourceRefs[field === 'spriteName' ? 'sprite' : field] = {
              source: 'mod',
              ownerKind: record.target.target.kind as 'ship' | 'weapon',
              ownerId: record.target.target.id,
              key: field,
              relPath: 'graphics/sample.svg',
            };
        }
      }
      if (data.hull) data.hull.sprite = data.records.find((r) => r.key === data.hull!.hullKey)?.resourceRefs.sprite ?? null;
      graphs.set(key, retargetJointFixture(data));
    }
    return graphs.get(key)!;
  }
  function catalog(kind: JointVariantCatalogKind) {
    const preview = kind === 'wings' && !catalogs.has(kind) ? graph('wing') : null;
    const previewHull = preview?.hull;
    if (!catalogs.has(kind))
      catalogs.set(
        kind,
        Array.from({ length: count }, (_, i): JointVariantEntry => {
          const id =
            kind === 'weapons'
              ? i === 0
                ? 'chaingun'
                : 'weapon_' + i
              : kind === 'wings'
                ? i === 0
                  ? 'sarissa_wing'
                  : 'wing_' + i
                : i === 0
                  ? 'rangefinder'
                  : 'hullmod_' + i;
          const resource = {
            source: 'mod' as const,
            ownerKind: (kind === 'weapons' ? 'weapon' : kind === 'wings' ? 'ship' : 'hullmods') as 'weapon' | 'ship' | 'hullmods',
            ownerId: id,
            key: 'sprite',
            relPath: 'graphics/sample.svg',
          };
          const location = fixtureLocation(sampleRoot, kind + '.csv');
          const hull = previewHull;
          return {
            id,
            label: `${kind} ${i + 1}`,
            source: location,
            sourceVersion: { path: location.path, fingerprint: '1' },
            resourceRefs: { turretSprite: resource, sprite: resource, icon: resource },
            data: {
              id,
              name: `${kind} ${i + 1}`,
              OPs: '10',
              'op cost': '12',
              range: '600',
              role: 'FIGHTER',
              num: '3',
              formation: 'CLAW',
              variant: 'sarissa_Fighter',
              cost_cruiser: '10',
              uiTags: 'Weapons',
              'tech/manufacturer': 'Low Tech',
            },
            spec: {
              id,
              specClass: 'projectile',
              type: 'BALLISTIC',
              size: 'MEDIUM',
              turretSprite: 'graphics/sample.svg',
              turretOffsets: [0, 0],
              turretAngleOffsets: [0],
            },
            specSource: location,
            specVersion: { path: location.path, fingerprint: '1' },
            projectile: null,
            primaryRole: 'Support',
            preview: hull
              ? {
                  hull: { ...hull, sprite: resource },
                  spec: jointObject(preview!.records.find((record) => record.key === hull.hullKey)!.value),
                  specs: [],
                }
              : null,
          };
        }),
      );
    return catalogs.get(kind)!;
  }
  function project(root: JointEditRoot, values: Record<string, JointValue> | null = null) {
    const snapshot = structuredClone(graph(root.kind, root.id));
    for (const [key, value] of Object.entries(values ?? {})) snapshot.records.find((r) => r.key === key)!.value = structuredClone(value);
    const record = (key: string) => snapshot.records.find((r) => r.key === key)!;
    const data = (key: string) => jointObject(record(key).value);
    const reference = (key: string, id: string) => {
      const item = record(key),
        value = { ...data(key) };
      if ((item.target.kind === 'spec' ? item.target.target.id : item.target.kind === 'csv' ? item.target.identity.id : null) === id)
        return;
      value[item.target.kind === 'spec' ? entityContentIdField(item.target.target.kind) : 'id'] = id;
      item.value = { state: 'present', value };
      if (item.target.kind === 'spec') {
        item.target.target = fixtureSpecTarget(item.target.target.kind, value, sampleRoot);
        item.source = item.target.target.write;
        item.sourceVersion = { path: item.source.path, fingerprint: 'fixture-v1' };
        item.baseVersions = [item.sourceVersion];
      } else if (item.target.kind === 'csv') item.target.identity.id = id;
    };
    if (root.kind === 'weapon' && data(snapshot.bindings.spec!).specClass !== 'beam')
      reference(snapshot.bindings.projectile!, String(data(snapshot.bindings.spec!).projectileSpecId));
    if (root.kind === 'ship' || root.kind === 'wing') {
      const id = String(data(snapshot.bindings[root.kind === 'wing' ? 'hullCsv' : 'csv']!)['system id']);
      for (const key of [snapshot.bindings.system!, 'system-csv', 'system-description']) reference(key, id);
    }
    if (root.kind === 'wing') reference(snapshot.bindings.variant!, String(data(snapshot.bindings.csv!).variant));
    if (root.kind === 'wing' || root.kind === 'variant') {
      const id = String(data(snapshot.bindings.variant!).hullId);
      reference(snapshot.hull!.hullKey, id);
      reference(snapshot.hull!.fields.name!.recordKey, id);
    }
    if (root.kind === 'variant') {
      for (const key of variantEditableRecords(snapshot)) {
        const hull = snapshot.variants[key]!;
        const data = jointObject(snapshot.records.find((r) => r.key === key)!.value);
        hull.weapons = { ...hull.builtInWeapons, ...Object.assign({}, ...(data.weaponGroups as RowData[]).map((group) => group.weapons)) };
        for (const [kind, ids] of [
          ['weapons', Object.values(hull.weapons)],
          ['wings', data.wings],
          ['hullmods', [...(data.hullMods as string[]), ...(data.permaMods as string[]), ...(data.sMods as string[])]],
        ] as const) {
          for (const id of ids as string[]) {
            if (!id || snapshot.records.some((r) => r.target.kind === 'csv' && r.target.table === kind && r.target.identity.id === id))
              continue;
            const entry = catalog(kind).find((entry) => entry.id === id)!;
            const graphSource = kind === 'weapons' ? graph('weapon', id) : kind === 'wings' ? graph('wing', id) : graph('variant');
            const prefix = `${kind}:${id}:`;
            for (const source of structuredClone(graphSource.records.filter((r) => (kind === 'hullmods' ? r.key === 'mod' : true)))) {
              source.key = prefix + source.key;
              if (kind === 'hullmods') {
                source.target = { kind: 'csv', table: kind, rowKey: id, identity: { id }, write: entry.source };
                source.value = { state: 'present', value: entry.data };
              }
              snapshot.records.push(source);
            }
            if (kind === 'wings') {
              const hull = structuredClone(graphSource.hull!);
              hull.variantKey = prefix + hull.variantKey;
              hull.hullKey = prefix + hull.hullKey;
              hull.fields = Object.fromEntries(
                Object.entries(hull.fields).map(([key, binding]) => [key, { ...binding, recordKey: prefix + binding.recordKey }]),
              );
              hull.displayBindings = Object.fromEntries(Object.entries(hull.displayBindings).map(([key, value]) => [key, prefix + value]));
              snapshot.variants[hull.variantKey] = hull;
            }
          }
        }
      }
      snapshot.hull = snapshot.variants[snapshot.bindings.variant!]!;
    }
    return snapshot;
  }
  function receipt<T>(refreshedEntity: T) {
    const result = { ...savedWriteFixture(), refreshedEntity, commitId: ++commitId };
    const update = sessionUpdateFixture(sessionId, sampleRoot, commitId);
    update.projection.manifest = structuredClone(manifest);
    result.sessionUpdates = [update];
    commits.set(result.commitId, result);
    return result;
  }
  function saveCsv(payload: SaveCsvPatchPayload) {
    const result = receipt(null);
    for (const patch of payload.patches) {
      const index = rows.findIndex((row) => row.rowKey === patch.rowKey);
      if (patch.action === 'delete') rows.splice(index, 1);
      else if (index >= 0) rows[index] = { rowKey: patch.rowKey, data: structuredClone(patch.row), isComment: patch.isComment };
      else
        rows.splice(patch.insertAt ?? rows.length, 0, {
          rowKey: patch.rowKey,
          data: structuredClone(patch.row),
          isComment: patch.isComment,
        });
    }
    if (payload.rowOrder) {
      const byKey = new Map(rows.map((row) => [row.rowKey, row]));
      rows.splice(0, rows.length, ...payload.rowOrder.map((key) => byKey.get(key)!));
    }
    rows.forEach((row, rowIndex) => {
      if (row.rowKey.includes(':new:')) {
        const previousKey = row.rowKey;
        row.rowKey = 'ships:row:' + nextRow++;
        result.keyMap.push({ previousKey, nextKey: row.rowKey, rowIndex });
      }
    });
    manifest.tableSummaries.ships.totalRows = rows.length;
    result.baseVersions = [{ path: manifest.tableSummaries.ships.path, fingerprint: String(commitId) }];
    result.invalidation.queryScopes = [{ kind: 'csv-table-window', table: 'ships', source: null, entity: null, resource: null }];
    result.sessionUpdates[0] = sessionUpdateFixture(sessionId, sampleRoot, commitId);
    if (result.sessionUpdates[0].status === 'ready') {
      result.sessionUpdates[0].projection.manifest = structuredClone(manifest);
      result.sessionUpdates[0].projection.invalidation = result.invalidation;
    }
    return result;
  }
  function saveJoint(payload: SaveJointEditPayload) {
    const snapshot = project(payload.snapshot.root, payload.values);
    for (const record of snapshot.records) {
      record.sourceVersion!.fingerprint = String(commitId + 1);
      record.baseVersions = [{ ...record.sourceVersion! }];
    }
    snapshot.baseVersions = [...new Map(snapshot.records.flatMap((r) => r.baseVersions).map((v) => [v.path, v])).values()];
    graphs.set(snapshot.root.kind + ':' + snapshot.root.id, structuredClone(snapshot));
    if (graphs.get(snapshot.root.kind + ':default')?.root.id === snapshot.root.id)
      graphs.set(snapshot.root.kind + ':default', structuredClone(snapshot));
    const result = receipt(snapshot);
    result.baseVersions = snapshot.baseVersions;
    return result;
  }
  function windowContext(kind: JointEditKind) {
    const snapshot = graph(kind);
    graphs.set(kind + ':' + snapshot.root.id, snapshot);
    context = {
      label: 'browser-' + kind,
      revision: ++windowRevision,
      requestId: 1,
      receiverGeneration: 1,
      title: '浏览器验证',
      kind: 'immersive-editor',
      identity: { type: 'immersive', ...snapshot.root },
      input: { kind: 'immersive-editor', rowKey: kind === 'wing' ? 'wing-row' : null },
    };
    return context;
  }
  return {
    scene,
    count,
    sessionId,
    rows,
    header,
    manifest,
    monitor,
    failures,
    graph,
    catalog,
    project,
    receipt,
    saveCsv,
    saveJoint,
    windowContext,
    commits,
    get context() {
      return context;
    },
    set context(next: ManagedWindowContext) {
      context = next;
      windowRevision = next.revision;
    },
    get settings() {
      return structuredClone(settings);
    },
    saveSettings(value: AppSettings) {
      settings = structuredClone(value);
      revision = ++settingsRevision;
      return { revision, value: structuredClone(settings), performanceMonitorActive: monitor.enabled };
    },
    settingsSnapshot: () => ({ revision, value: structuredClone(settings), performanceMonitorActive: monitor.enabled }),
    get reads() {
      return reads;
    },
    readRows() {
      reads++;
    },
    get commitId() {
      return commitId;
    },
  };
}
export type BrowserModel = ReturnType<typeof createBrowserModel>;
