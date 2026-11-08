import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvValidationContext, JointEditSnapshot } from '@/shared/types';
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
  stationData: {},
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
