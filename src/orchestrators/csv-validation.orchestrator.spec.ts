import { WEAPON_SPEC_CLASSES } from '@/domain/entity-write/spec-construction';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { savedContentWorks } from '@/test/unit/project-changes';
import { csvDraftRow } from '@/test/fixtures/csv-row';
import { replaceCsvTableDraft } from '@/domain/csv-editor/csv-table-draft';
import { saveCsvChanges } from './csv-save.orchestrator';
import type { AppFeedback, CsvValidationContext } from '@/shared/types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn<typeof importType.saveCsvPatch>() }));
vi.mock('@/services/csv-table.service', async (original) => ({
  ...(await original<typeof importType>()),
  queryCsvValidation: mocks.read,
  saveCsvPatch: mocks.write,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await vi.importActual('@/orchestrators/project-sync.orchestrator')),
  beginSavedWrite: (await import('@/test/unit/project-changes')).beginSavedWrite,
}));
vi.mock('@/services/window.service', () => ({ reserveNativeWindowTargets: async () => {}, releaseNativeWindowTargets: async () => {} }));
import type * as importType from '@/services/csv-table.service';
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  initializeSettingsStore(createSettingsFixture());
  mocks.write.mockImplementation(async (_session, _root, table, patches) =>
    savedWriteFixture(
      {
        table,
        baseVersions: [],
        rows: patches
          .filter((patch) => patch.action === 'upsert')
          .map((patch) => ({
            rowKey: patch.rowKey,
            data: patch.row,
            isComment: patch.isComment,
          })),
      },
      { kind: 'csv', table },
    ),
  );
});
function fixture() {
  const tables = useCsvEditorStore(),
    manifest = sessionUpdateFixture('validation-save', 'M:/validation-save').content.manifest;
  manifest.associatedSpecTables = [];
  useProjectStore().registerProjectManifest(manifest);
  tables.initializeModTables({ ...manifest, manifest });
  const target = { sessionId: manifest.sessionId, modRoot: manifest.modRoot, table: 'ships' as const },
    document = tables.getCsvModState(target.modRoot)!.documents.ships;
  document.header = ['id', 'name', 'mass', 'shield type', 'hints'];
  replaceCsvTableDraft(document, [csvDraftRow({ id: 'sample', name: 'Sample', mass: '100', 'shield type': 'NONE', hints: '' }, 'row')]);
  const choose = vi.fn<AppFeedback['choose']>().mockResolvedValue(null);
  const feedback: AppFeedback = {
    choose,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
  };
  const edit = (key: string, value: string) => tables.updateCellValue({ ...target, rowKey: 'row', column: key }, value);
  const save = () => saveCsvChanges({ table: 'ships', manifest, feedback, selectAssociatedSpecs: async () => [] });
  const context: CsvValidationContext = {
    complete: true,
    entities: { 'ship:sample': { hullSize: 'FRIGATE', weaponSlots: [] } },
    sources: {},
    files: {},
    classes: {},
  };
  return { tables, manifest, target, document, edit, save, context, choose };
}
describe('CSV schema checks in the actual save entry', () => {
  it('refreshes retained dependency errors before deciding the captured save', async () => {
    const f = fixture();
    f.edit('name', 'Edited');
    const { csvValidationRequest } = await import('@/domain/csv-editor/csv-rule-context');
    const { csvValidationRows } = await import('@/domain/csv-editor/csv-validation');
    f.tables.acceptTableValidation(f.target, JSON.stringify(csvValidationRequest('ships', csvValidationRows(f.document))), {
      ...f.context,
      entities: {},
    });
    expect(f.tables.getTableProblems(f.target).issues.value).toMatchObject([{ code: 'csv.spec_missing' }]);
    mocks.read.mockResolvedValueOnce(f.context);
    await expect(f.save()).resolves.toMatchObject({ status: 'saved' });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it.each(WEAPON_SPEC_CLASSES)('saves burst size through its declared float type with %s associated content', async (specClass) => {
    const f = fixture();
    const target = { ...f.target, table: 'weapons' as const };
    const document = f.tables.getCsvModState(target.modRoot)!.documents.weapons;
    document.header = ['id', 'name', 'burst size'];
    replaceCsvTableDraft(document, [csvDraftRow({ id: 'sample', name: 'Sample', 'burst size': '2' }, 'weapon-row')]);
    f.tables.updateCellValue({ ...target, rowKey: 'weapon-row', column: 'burst size' }, '2.625');
    mocks.read.mockResolvedValueOnce({ ...f.context, entities: { 'weapon:sample': { specClass } } });
    await expect(saveCsvChanges({ table: 'weapons', manifest: f.manifest, selectAssociatedSpecs: async () => [] })).resolves.toMatchObject({
      status: 'saved',
    });
    await savedContentWorks.at(-1)!.content;
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]![3][0]!.row['burst size']).toBe('2.625');
    expect(document.baselineRows['weapon-row']!.data['burst size']).toBe('2.625');
  });
  it('saves annotation content through the formal save entry', async () => {
    const f = fixture();
    replaceCsvTableDraft(f.document, [csvDraftRow({ id: '', name: '', mass: '', 'shield type': '', hints: '' }, 'row')]);
    f.edit('name', 'Section');
    const content = { ...f.document.rows.row!.data };
    mocks.read.mockResolvedValueOnce(f.context);
    await expect(f.save()).resolves.toMatchObject({ status: 'saved' });
    await savedContentWorks.at(-1)!.content;
    expect(f.tables.getTableProblems(f.target).issues.value).toEqual([]);
    expect(f.choose).toHaveBeenCalledTimes(0);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(f.target.sessionId, {
      entities: [],
      sources: [],
      files: [],
      classes: [],
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]![3]).toEqual([
      { rowKey: 'row', action: 'upsert', isComment: false, row: content, columns: ['name'], commentChanged: false },
    ]);
    expect(f.document.baselineRows.row!.data).toEqual(content);
    expect(f.document.dirty).toEqual({});
  });
  it('blocks a submitted numeric input before reading dependencies', async () => {
    const f = fixture(),
      dirty = ref(true);
    f.tables.getTableInputs(f.target.modRoot, 'ships').register({
      key: 'mass',
      label: 'Mass',
      dirty,
      commit: () => {
        f.edit('mass', 'invalid');
        dirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    await expect(f.save()).rejects.toMatchObject({ action: 'csv-validation' });
    expect(f.tables.getTableProblems(f.target).issues.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'csv.value_invalid', path: 'row/mass' })]),
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rechecks types after dependency reads complete', async () => {
    const f = fixture();
    f.edit('name', 'Edited');
    let finish!: (value: CsvValidationContext) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<CsvValidationContext>((resolve) => {
          finish = resolve;
        }),
    );
    const save = f.save();
    await flushPromises();
    f.edit('mass', 'invalid');
    finish(f.context);
    await expect(save).rejects.toMatchObject({ action: 'csv-validation' });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('retains a dependency failure and retries through warning confirmation', async () => {
    const f = fixture();
    f.edit('mass', '-1');
    mocks.read.mockRejectedValueOnce(new Error('Source read failed'));
    await expect(f.save()).rejects.toThrow('Source read failed');
    expect(f.tables.getTableProblems(f.target).issues.value.some((i) => i.severity === 'error')).toBe(true);
    mocks.read.mockResolvedValueOnce(f.context);
    expect(await f.save()).toMatchObject({ status: 'cancelled' });
    expect(f.choose).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
