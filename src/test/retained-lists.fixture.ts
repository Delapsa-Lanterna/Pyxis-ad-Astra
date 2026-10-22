import { sessionUpdateFixture, savedWriteFixture } from '@/test/write-result';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { bitmapFontFixture } from '@/test/font';
import type { CsvRowRecord, JointVariantCatalogKind, JointVariantEntry, PerformanceBatch } from '@/shared/types';

const source = { source: 'mod' as const, root: 'M:/benchmark', path: 'M:/benchmark/table.csv', relPath: 'table.csv' };
const header = [
  'id',
  'name',
  'designation',
  'tags',
  'hullSize',
  'fleet pts',
  'base value',
  ...Array.from({ length: 33 }, (_, index) => 'field_' + index),
];
const texture = document.createElement('canvas');
texture.width = texture.height = 16;
const context = texture.getContext('2d')!;
context.fillStyle = '#8db5ce';
context.fillRect(2, 1, 12, 14);
context.fillStyle = '#edf6fc';
context.fillRect(5, 0, 6, 9);
const dataUrl = texture.toDataURL();
export const fixture = {
  session: 'retained-bench',
  rows: [] as CsvRowRecord[],
  byKey: new Map<string, CsvRowRecord>(),
  entries: [] as JointVariantEntry[],
  kind: 'weapons' as JointVariantCatalogKind,
  revision: 1,
  reads: 0,
  monitorBatches: [] as PerformanceBatch[],
  snapshot: variantJointFixture(),
  manifest: sessionUpdateFixture('retained-bench', 'M:/benchmark').projection.manifest,
};
export function prepareFixture(count: number, kind: 'csv' | JointVariantCatalogKind, session: string) {
  fixture.session = session;
  fixture.revision = 1;
  fixture.reads = 0;
  fixture.manifest = sessionUpdateFixture(session, 'M:/benchmark').projection.manifest;
  fixture.manifest.modInfo = { name: 'Retained list benchmark' };
  fixture.manifest.associatedSpecTables = [];
  fixture.manifest.tableSummaries.ships = { path: 'table.csv', header, available: true, totalRows: count };
  fixture.rows =
    kind === 'csv'
      ? Array.from({ length: count }, (_, index) => ({
          rowKey: 'ships:row:' + index,
          isComment: index % 97 === 0,
          data: Object.fromEntries(
            header.map((key) => [
              key,
              key === 'id'
                ? 'ship_' + index
                : key === 'name'
                  ? 'Sample ship ' + index
                  : key === 'tags'
                    ? 'sample,benchmark'
                    : key === 'hullSize'
                      ? 'CRUISER'
                      : String(index),
            ]),
          ),
        }))
      : [];
  fixture.byKey = new Map(fixture.rows.map((row) => [row.rowKey, row]));
  fixture.snapshot = variantJointFixture();
  fixture.snapshot.root = { ...fixture.snapshot.root, sessionId: session, modRoot: 'M:/benchmark' };
  const resource = { source: 'mod' as const, relPath: 'sample.png', ownerKind: 'weapon' as const, ownerId: 'sample', key: 'sample' };
  fixture.kind = kind === 'csv' ? 'weapons' : kind;
  fixture.entries =
    kind === 'csv'
      ? []
      : Array.from({ length: count }, (_, index) => ({
          id: 'entry_' + index,
          label: 'Sample ' + index,
          source,
          sourceVersion: { path: source.path, fingerprint: '1' },
          resourceRefs: { turretSprite: resource, sprite: resource, icon: resource },
          data: {
            id: 'entry_' + index,
            name: 'Sample ' + index,
            OPs: String(index % 40),
            'op cost': '12',
            range: '600',
            role: 'FIGHTER',
            num: '3',
            formation: 'CLAW',
            cost_cruiser: String(index % 40),
            uiTags: 'Weapons',
            'tech/manufacturer': 'Common',
          },
          spec: { type: 'BALLISTIC', size: 'MEDIUM', turretSprite: 'sample.png', turretOffsets: [0, 0], turretAngleOffsets: [0] },
          specSource: source,
          specVersion: { path: source.path, fingerprint: '1' },
          preview: {
            hull: { ...fixture.snapshot.hull!, sprite: resource },
            spec: { width: 200, height: 360, center: [100, 180], hullSize: 'CRUISER' },
            specs: [],
          },
          projectile: null,
          primaryRole: 'Support',
        }));
}
type Payload = { [key: string]: unknown };
export async function invokeCommand(
  command: string,
  args: { payload?: Payload; batch?: PerformanceBatch; action?: string } = {},
): Promise<unknown> {
  if (command === 'performance_monitor_batch') {
    fixture.monitorBatches.push(args.batch!);
    return;
  }
  if (command === 'performance_monitor_report')
    return {
      enabled: new URLSearchParams(location.search).get('monitor') === 'on',
      records: fixture.monitorBatches.reduce((sum, batch) => sum + batch.samples.length, 0),
      overwritten: 0,
      startedAt: 0,
      path: '',
    };
  const payload = args.payload ?? {};
  if (command === 'query_system_fonts') return [];
  if (command === 'get_app_log_status')
    return { path: 'preview.log', sizeBytes: 0, recording: 'active', level: 'info', lastError: null, dropped: 0, pending: 0 };
  if (command === 'query_csv_source_options') return [];
  if (command === 'query_csv_row_preview') return { resourceRef: null };
  if (command === 'query_original_font')
    return {
      status: 'available',
      root: 'M:/game',
      fontId: payload.fontId,
      path: 'benchmark.fnt',
      definition: bitmapFontFixture(' ?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:/·，装配点当前卸下'),
      pages: [{ id: 0, path: 'page.png', dataUrl }],
    };
  if (command === 'query_resource_data_urls')
    return { entries: (payload.resources as import('@/shared/types').ResourceRef[]).map((resource) => ({ ...resource, dataUrl })) };
  if (command === 'query_joint_edit')
    return payload.catalog
      ? {
          root: fixture.snapshot.root,
          catalog: { kind: fixture.kind, entries: fixture.entries },
          referenceSettings: fixture.snapshot.referenceSettings,
        }
      : fixture.snapshot;
  if (command === 'query_csv_table_window' || command === 'query_csv_table_index') {
    fixture.reads++;
    const search = String(payload.search ?? '')
      .trim()
      .toLowerCase();
    const rows = search
      ? fixture.rows.filter((row) => ['id', 'name'].some((key) => String(row.data[key]).toLowerCase().includes(search)))
      : fixture.rows;
    const start = Number(payload.start ?? 0),
      count = Number(payload.count ?? payload.initialCount ?? 240);
    return {
      baseVersions: [{ path: 'table.csv', fingerprint: String(fixture.revision) }],
      table: 'ships',
      header,
      totalRows: fixture.rows.length,
      filteredRows: rows.length,
      rowKeys: rows.map((row) => row.rowKey),
      start,
      rows: rows.slice(start, start + count).map((row, index) => ({ ...structuredClone(row), sourceRowIndex: start + index })),
    };
  }
  if (command === 'query_csv_table_rows') {
    fixture.reads++;
    return {
      table: 'ships',
      baseVersions: [{ path: 'table.csv', fingerprint: String(fixture.revision) }],
      rows: (payload.rowKeys as string[]).map((key) => structuredClone(fixture.byKey.get(key)!)),
    };
  }
  if (command === 'save_csv_patch') {
    const result = savedWriteFixture();
    result.baseVersions = [{ path: 'table.csv', fingerprint: String(++fixture.revision) }];
    const accepted = sessionUpdateFixture(fixture.session, 'M:/benchmark', fixture.revision);
    accepted.projection.manifest = structuredClone(fixture.manifest);
    result.sessionUpdates = [accepted];
    return result;
  }
  return undefined;
}
