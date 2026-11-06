import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvDraftRow } from '@/test/fixtures/csv-row';
import { replaceCsvTableDraft } from '@/domain/csv-editor/csv-table-draft';
import { saveCsvChanges } from './csv-save.orchestrator';
import type { AppFeedback, CsvValidationContext } from '@/shared/types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/services/csv-table.service', async (original) => ({
  ...(await original<typeof importType>()),
  queryCsvValidation: mocks.read,
  saveCsvPatch: mocks.write,
}));
vi.mock('@/services/window.service', () => ({ reserveNativeWindowTargets: async () => {}, releaseNativeWindowTargets: async () => {} }));
import type * as importType from '@/services/csv-table.service';
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  initializeSettingsStore(createSettingsFixture());
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
    stationData: {},
  };
  return { tables, target, document, edit, save, context, choose };
}
describe('CSV schema checks in the actual save entry', () => {
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
