import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvTableKey, CsvValidationContext, JointEditSnapshot } from '@/shared/types';
import { createShipSpec, createWeaponSpec, createDefaultVariant, createDefaultSkin } from '@/domain/entity-write/spec-construction';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { fixtureCsvRecord, fixtureJointSnapshot, fixtureSpecRecord } from '@/test/fixtures/joint-edit/joint-record';
import { csvDraftRow, csvTableIndex } from '@/test/fixtures/csv-row';
import { jointProblemBlocks } from '@/domain/joint-edit';
import { validateJointFiles } from './joint-editor-validation';

const reads = vi.hoisted(() => ({ index: vi.fn(), context: vi.fn(), graph: vi.fn() }));
vi.mock('@/services/csv-table.service', () => ({ queryTableIndex: reads.index, queryCsvValidation: reads.context }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointEditPreview: reads.graph }));
const context = (): CsvValidationContext => ({
  complete: true,
  entities: { 'weapon:one': {}, 'weapon:two': {} },
  sources: {},
  files: {},
  classes: {},
});
function fixture() {
  const records = [fixtureCsvRecord('csv', 'weapons', { id: 'one' }, { id: 'one', name: 'One', OPs: '2' })];
  return fixtureJointSnapshot('weapon', 'one', records, { csv: 'csv' });
}
beforeEach(() => {
  vi.resetAllMocks();
  reads.graph.mockImplementation(async ({ baseline }) => baseline);
  reads.context.mockResolvedValue(context());
  reads.index.mockResolvedValue(
    csvTableIndex(
      [csvDraftRow({ id: 'one', name: 'One', OPs: '2' }, 'csv'), csvDraftRow({ id: 'two', name: 'Two', OPs: '1.5' }, 'other')],
      { table: 'weapons' },
    ),
  );
});
describe('joint file validation', () => {
  it.each([false, true])('shares all table references and retains file results when the reference read fails=%s', async (failed) => {
    const tables: CsvTableKey[] = ['ships', 'wings', 'descriptions', 'shipSystems'];
    const rows: { id: string; [key: string]: string }[] = [
      { id: 'probe', name: 'Probe', mass: 'invalid', 'shield type': 'NONE', 'system id': 'system', 'defense id': 'system' },
      { id: 'probe_wing', variant: 'loadout' },
      { id: 'probe', type: 'SHIP', text1: 'Probe' },
      { id: 'system', name: 'System', icon: 'graphics/probe.png' },
    ];
    const records = tables.map((table, i) => fixtureCsvRecord(table, table, { id: rows[i]!.id }, rows[i]!));
    const snapshot = fixtureJointSnapshot('wing', 'probe_wing', records, { csv: 'wings' });
    reads.index.mockImplementation(async (_session: string, table: CsvTableKey) =>
      csvTableIndex([csvDraftRow(rows[tables.indexOf(table)]!, table)], { table }),
    );
    if (failed) reads.context.mockRejectedValue(new Error('reference read failed'));
    const before = JSON.stringify(snapshot);
    for (const issues of await Promise.all([validateJointFiles(snapshot, {}), validateJointFiles(snapshot, {})])) {
      expect(issues.filter((issue) => issue.code === 'unknown').map((issue) => issue.location?.path)).toEqual(
        failed ? records.map((record) => record.source!.path) : [],
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'csv.value_invalid', location: expect.objectContaining({ field: 'mass' }) }),
      );
    }
    expect(reads.context).toHaveBeenCalledTimes(2);
    expect(reads.context.mock.calls[0]![1]).toMatchObject({
      entities: [
        { kind: 'ship', id: 'probe' },
        { kind: 'variant', id: 'loadout' },
        { kind: 'skin', id: 'probe' },
        { kind: 'system', id: 'system' },
      ],
      sources: ['csv:shipSystems.id'],
      files: ['graphics/probe.png'],
    });
    expect(JSON.stringify(snapshot)).toBe(before);
    await validateJointFiles(snapshot, {});
    expect(reads.context).toHaveBeenCalledTimes(3);
  });
  it('reports an unreadable table independently and validates the remaining table', async () => {
    const snapshot = fixture();
    snapshot.records.push(fixtureCsvRecord('description', 'descriptions', { id: 'one', type: 'WEAPON' }, { id: 'one', type: 'WEAPON' }));
    reads.index.mockRejectedValueOnce(new Error('table read failed'));
    const issues = await validateJointFiles(snapshot, {});
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unknown', location: expect.objectContaining({ path: snapshot.records[0]!.source!.path }) }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'csv.column_missing',
        location: expect.objectContaining({ path: snapshot.records[1]!.source!.path, field: 'type' }),
      }),
    );
    expect(reads.context).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation of the combined reference read', async () => {
    const controller = new AbortController();
    const failure = new Error('cancelled');
    reads.context.mockImplementation(async () => {
      controller.abort();
      throw failure;
    });
    await expect(validateJointFiles(fixture(), {}, controller.signal)).rejects.toBe(failure);
    expect(reads.context).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['ship', 'ships', 'hullId', 'id'],
    ['weapon', 'weapons', 'id', 'id'],
    ['variant', 'wings', 'variantId', 'variant'],
    ['skin', 'descriptions', 'skinHullId', 'id'],
  ] as const)('checks the submitted %s identity against its %s row', async (kind, table, idField, column) => {
    const spec =
      kind === 'ship'
        ? createShipSpec('before')
        : kind === 'weapon'
          ? createWeaponSpec('before', 'beam')
          : kind === 'variant'
            ? createDefaultVariant('base', 'before')
            : createDefaultSkin('base', 'before');
    const row = { id: 'before', name: 'Probe', type: 'SHIP', text1: 'Probe', variant: 'before' };
    const records = [fixtureCsvRecord('csv', table, { id: 'before' }, row), fixtureSpecRecord('spec', kind, spec)];
    const snapshot = fixtureJointSnapshot(kind, 'before', records, { csv: 'csv', spec: 'spec' });
    reads.index.mockResolvedValue(
      csvTableIndex([csvDraftRow(row, 'csv')], { table, header: getCsvColumnSchemas(table).map((c) => c.key) }),
    );
    const values = {
      csv: { state: 'present' as const, value: { ...row, [column]: 'after' } },
      spec: { state: 'present' as const, value: { ...spec, [idField]: 'after' } },
    };
    const before = JSON.stringify([snapshot, values]);
    const issues = await validateJointFiles(snapshot, values);
    expect(issues.filter((issue) => ['csv.spec_missing', 'csv.variant_missing', 'csv.description_reference'].includes(issue.code))).toEqual(
      [],
    );
    expect(JSON.stringify([snapshot, values])).toBe(before);
  });
  it.each([false, true])('resolves the old local identity from its remaining base when present=%s', async (fallback) => {
    const spec = fixtureSpecRecord('spec', 'ship', createShipSpec('before'));
    if (fallback)
      spec.composition = {
        replace: false,
        excluded: [],
        layers: [
          {
            source: { ...spec.source!, source: 'core' },
            version: { path: spec.source!.path, fingerprint: 'base' },
            replace: false,
            data: createShipSpec('before'),
          },
        ],
      };
    const row = { id: 'before', type: 'SHIP', text1: 'Probe' };
    const snapshot = fixtureJointSnapshot(
      'ship',
      'before',
      [spec, fixtureCsvRecord('csv', 'descriptions', { id: 'before', type: 'SHIP' }, row)],
      { spec: 'spec' },
    );
    reads.index.mockResolvedValue(csvTableIndex([csvDraftRow(row, 'csv')], { table: 'descriptions' }));
    const ctx = context();
    ctx.entities['ship:before'] = createShipSpec('before');
    reads.context.mockResolvedValue(ctx);
    const issues = await validateJointFiles(snapshot, { spec: { state: 'present', value: createShipSpec('after') } });
    expect(issues.filter((issue) => issue.code === 'csv.description_reference')).toHaveLength(fallback ? 0 : 1);
    expect(ctx.entities['ship:before']).toEqual(createShipSpec('before'));
  });
  it('checks an automatically renamed associated CSV row using its submitted spec identity', async () => {
    const row = { id: 'before', name: 'Probe', mass: '1', 'shield type': 'NONE' };
    const snapshot = fixtureJointSnapshot(
      'ship',
      'before',
      [fixtureCsvRecord('csv', 'ships', { id: 'before' }, row), fixtureSpecRecord('spec', 'ship', createShipSpec('before'))],
      { csv: 'csv', spec: 'spec' },
    );
    reads.index.mockResolvedValue(csvTableIndex([csvDraftRow(row, 'csv')], { table: 'ships' }));
    const issues = await validateJointFiles(snapshot, { spec: { state: 'present', value: createShipSpec('after') } });
    expect(issues.filter((issue) => issue.code === 'csv.spec_missing')).toEqual([]);
  });
  it.each([false, true])('checks a deleted local spec against its physical base when present=%s', async (fallback) => {
    const spec = fixtureSpecRecord('spec', 'ship', createShipSpec('probe'));
    if (fallback)
      spec.composition = {
        replace: true,
        excluded: [],
        layers: [
          {
            source: { ...spec.source!, source: 'core' },
            version: { path: spec.source!.path, fingerprint: 'base' },
            replace: false,
            data: createShipSpec('probe'),
          },
        ],
      };
    const row = { id: 'probe', name: 'Probe', mass: '1', 'shield type': 'NONE' };
    const snapshot = fixtureJointSnapshot('ship', 'probe', [fixtureCsvRecord('csv', 'ships', { id: 'probe' }, row), spec], {
      csv: 'csv',
      spec: 'spec',
    });
    reads.index.mockResolvedValue(csvTableIndex([csvDraftRow(row, 'csv')], { table: 'ships' }));
    const ctx = context();
    ctx.entities['ship:probe'] = createShipSpec('probe');
    reads.context.mockResolvedValue(ctx);
    const issues = await validateJointFiles(snapshot, { spec: { state: 'missing' } });
    expect(issues.filter((issue) => issue.code === 'csv.spec_missing')).toHaveLength(fallback ? 0 : 1);
  });
  it('checks an external table using saved identities while local drafts introduce a new identity', async () => {
    const row = { id: 'probe_wing', variant: 'after' },
      csv = fixtureCsvRecord('csv', 'wings', { id: 'probe_wing' }, row);
    csv.source = { ...csv.source!, source: 'core', path: 'G:/core/wing_data.csv' };
    const spec = fixtureSpecRecord('spec', 'variant', createDefaultVariant('base', 'before'));
    const snapshot = fixtureJointSnapshot('wing', 'probe_wing', [csv, spec], { csv: 'csv' });
    reads.index.mockImplementation(async (...args: unknown[]) =>
      csvTableIndex(args[6] ? [csvDraftRow(row, 'external')] : [], { table: 'wings' }),
    );
    const issues = await validateJointFiles(snapshot, { spec: { state: 'present', value: createDefaultVariant('base', 'after') } });
    expect(issues.filter((issue) => issue.code === 'csv.variant_missing')).toMatchObject([{ location: { path: csv.source.path } }]);
  });
  it('resolves the full external hull and wing tables behind a 229-problem snapshot', async () => {
    const ships = Array.from({ length: 200 }, (_, i) => csvDraftRow({ id: 'hull_' + i, name: 'Hull' }, 'hull:' + i));
    const wings = Array.from({ length: 31 }, (_, i) => csvDraftRow({ id: 'wing_' + i + '_wing', variant: 'variant_' + i }, 'wing:' + i));
    const ship = fixtureCsvRecord('shipCsv', 'ships', { id: 'hull_0' }, ships[0]!.data),
      wing = fixtureCsvRecord('wingCsv', 'wings', { id: 'wing_0_wing' }, wings[0]!.data);
    for (const record of [ship, wing]) record.source = { ...record.source!, source: 'core', path: 'G:/core/' + record.source!.relPath };
    const snapshot = fixtureJointSnapshot('wing', 'wing_0_wing', [ship, wing], { csv: 'wingCsv' });
    reads.index.mockImplementation(
      async (_session: string, table: string, _count: number, _search: unknown, _field: unknown, _signal: unknown, source: unknown) =>
        csvTableIndex(source ? (table === 'ships' ? ships : wings) : [], {
          header: getCsvColumnSchemas(table === 'ships' ? 'ships' : 'wings').map((c) => c.key),
        }),
    );
    const ctx = context();
    ctx.entities = { 'ship:hull_0': {}, 'variant:variant_0': {} };
    reads.context.mockResolvedValue(ctx);
    const missing = (issues: Awaited<ReturnType<typeof validateJointFiles>>) =>
      issues.filter((issue) => ['csv.spec_missing', 'csv.variant_missing'].includes(issue.code));
    expect(missing(await validateJointFiles(snapshot, {}))).toHaveLength(229);
    ctx.entities = Object.fromEntries([
      ...ships.map((row) => ['ship:' + row.data.id, {}]),
      ...wings.map((row) => ['variant:' + row.data.variant, {}]),
    ]);
    expect(missing(await validateJointFiles(snapshot, {}))).toEqual([]);
  });
  it('checks another row in the same file and preserves the snapshot and draft', async () => {
    const snapshot = fixture(),
      values = { csv: { state: 'present' as const, value: { id: 'one', name: 'Edited', OPs: '2' } } };
    const before = JSON.stringify([snapshot, values]);
    const issues = await validateJointFiles(snapshot, values);
    const invalid = issues.filter((issue) => issue.severity === 'error');
    expect(invalid).toMatchObject([
      { code: 'csv.value_invalid', location: { rowKey: 'other', field: 'OPs', path: 'M:/mod/data/weapons/weapon_data.csv' } },
    ]);
    expect(jointProblemBlocks(snapshot, values, invalid[0]!)).toBe(true);
    expect(JSON.stringify([snapshot, values])).toBe(before);
    expect(reads.index).toHaveBeenCalledTimes(1);
    expect(reads.context).toHaveBeenCalledTimes(1);
  });
  it('composes all modified rows once and retains independent warnings', async () => {
    const snapshot = fixture();
    snapshot.records.push(fixtureCsvRecord('csv-two', 'weapons', { id: 'two' }, { id: 'two', name: 'Two', OPs: '1.5' }, 'other'));
    const issues = await validateJointFiles(snapshot, {
      csv: { state: 'present', value: { id: 'one', name: 'One', OPs: '2', 'min spread': '8', 'max spread': '2' } },
      'csv-two': { state: 'present', value: { id: 'two', name: 'Two', OPs: '3' } },
    });
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues).toMatchObject([{ severity: 'warning', location: { field: 'min spread' } }]);
    expect(reads.index).toHaveBeenCalledTimes(1);
  });
  it('shows an unchanged external file error while allowing the local file', async () => {
    const snapshot = fixture();
    const external = fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'base', fleetPoints: null });
    external.source = { ...external.source!, source: 'core', path: 'G:/core/data/hulls/skins/overlay.skin' };
    snapshot.records.push(external);
    const values = { csv: { state: 'present' as const, value: { id: 'one', name: 'Edited', OPs: '2' } } };
    const issues = await validateJointFiles(snapshot, values);
    const invalid = issues.find((issue) => issue.location?.path === external.source!.path)!;
    expect(invalid).toMatchObject({ severity: 'error', location: { field: 'fleetPoints' } });
    expect(jointProblemBlocks(snapshot, values, invalid)).toBe(false);
    const overridden = { ...values, skin: external.value };
    expect(
      jointProblemBlocks(
        snapshot,
        overridden,
        { ...invalid, location: { ...invalid.location!, path: external.target.kind === 'spec' ? external.target.target.write.path : '' } },
        ['skin'],
      ),
    ).toBe(true);
  });
  it('retains every same-field error in separate spec files', async () => {
    const snapshot: JointEditSnapshot = fixtureJointSnapshot(
      'skin',
      'a',
      [
        fixtureSpecRecord('a', 'skin', { skinHullId: 'a', baseHullId: 'base', fleetPoints: null }),
        fixtureSpecRecord('b', 'skin', { skinHullId: 'b', baseHullId: 'base', fleetPoints: null }),
      ],
      { spec: 'a' },
    );
    const issues = await validateJointFiles(snapshot, {});
    expect(issues.map((issue) => [issue.location?.path, issue.location?.field])).toEqual([
      ['M:/mod/data/hulls/skins/a.skin', 'fleetPoints'],
      ['M:/mod/data/hulls/skins/b.skin', 'fleetPoints'],
    ]);
  });
  it('keeps a base-layer error at its source while checking the local partial content', async () => {
    const record = fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'base' });
    record.value = { state: 'present', value: { maxSpeed: 200 } };
    const source = { ...record.source!, source: 'core' as const, path: 'G:/core/overlay.skin' };
    record.composition = {
      replace: false,
      excluded: [],
      layers: [
        {
          source,
          version: { path: source.path, fingerprint: 'source' },
          replace: false,
          data: { skinHullId: 'overlay', baseHullId: 'base', fleetPoints: null },
        },
      ],
    };
    const snapshot = fixtureJointSnapshot('skin', 'overlay', [record], { spec: 'skin' });
    const values = { skin: record.value };
    const issues = await validateJointFiles(snapshot, values);
    expect(issues).toMatchObject([{ location: { path: source.path, field: 'fleetPoints' } }]);
    expect(issues.some((issue) => jointProblemBlocks(snapshot, values, issue))).toBe(false);
  });
  it('records source-read failures and rechecks on the next call', async () => {
    const snapshot = fixture();
    reads.context.mockRejectedValueOnce(new Error('read failed'));
    const failed = await validateJointFiles(snapshot, {});
    expect(failed).toMatchObject([
      { severity: 'error', code: 'unknown' },
      { severity: 'error', code: 'csv.value_invalid', location: { rowKey: 'other', field: 'OPs' } },
    ]);
    expect((await validateJointFiles(snapshot, {})).some((issue) => issue.code === 'csv.value_invalid')).toBe(true);
    expect(reads.context).toHaveBeenCalledTimes(2);
  });
  it('checks an unchanged override at its local write location', async () => {
    const record = fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'base', fleetPoints: null });
    record.source = { ...record.source!, source: 'core', path: 'G:/core/overlay.skin' };
    const snapshot = fixtureJointSnapshot('skin', 'overlay', [record], { spec: 'skin' });
    const values = { skin: record.value };
    const issues = await validateJointFiles(snapshot, values, undefined, ['skin']);
    expect(issues).toMatchObject([{ location: { path: 'M:/mod/data/hulls/skins/overlay.skin', field: 'fleetPoints' } }]);
    expect(jointProblemBlocks(snapshot, values, issues[0]!, ['skin'])).toBe(true);
  });
  it('checks a submitted file after its graph reference is removed', async () => {
    const record = fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'base', fleetPoints: null });
    const snapshot = fixtureJointSnapshot('skin', 'overlay', [record], { spec: 'skin' });
    reads.graph.mockResolvedValue({ ...snapshot, records: [] });
    const issues = await validateJointFiles(snapshot, { skin: record.value });
    expect(issues).toMatchObject([
      { code: 'spec.field_invalid', location: { path: 'M:/mod/data/hulls/skins/overlay.skin', field: 'fleetPoints' } },
    ]);
  });
  it('reports a source version change at its captured file location', async () => {
    const record = fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'base' });
    record.source = { ...record.source!, source: 'core', path: 'G:/core/overlay.skin' };
    record.sourceVersion = { path: record.source.path, fingerprint: 'original' };
    const snapshot = fixtureJointSnapshot('skin', 'overlay', [record], { spec: 'skin' });
    reads.graph.mockResolvedValue({
      ...snapshot,
      records: [{ ...record, sourceVersion: { ...record.sourceVersion!, fingerprint: 'changed' } }],
    });
    const issues = await validateJointFiles(snapshot, { skin: record.value });
    expect(issues).toMatchObject([{ code: 'write.version_conflict', location: { path: 'G:/core/overlay.skin' } }]);
    expect(jointProblemBlocks(snapshot, { skin: record.value }, issues[0]!)).toBe(true);
  });
});
