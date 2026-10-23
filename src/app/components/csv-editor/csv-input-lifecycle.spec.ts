import { csvTableIndex } from '@/test/csv-row';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvGrid from './CsvGrid.vue';
import { createCsvGridColumns } from '@/domain/csv-editor/csv-grid-model';
import { provideCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { TABLE_KEYS } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { sessionUpdateFixture } from '@/test/write-result';
import { applySavedCsvRowKeyMapDraft } from '@/domain/csv-editor/csv-table-draft';
import { editorUiStubs } from '@/test/ui-stubs';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(), error: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
});

function mountTable(control: 'number' | 'enum' = 'number', extraColumns = 0) {
  const root = 'M:/A';
  const target = { sessionId: 'sA', modRoot: root, table: 'ships' as const };
  const tables = useCsvEditorStore();
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: root, displayName: 'A', version: '', status: 'ready' });
  workspace.activateModTable(root);
  const tableManifest = sessionUpdateFixture('sA', root).projection.manifest;
  const header = ['width', ...Array.from({ length: extraColumns }, (_, index) => 'field' + index)];
  for (const key of TABLE_KEYS) tableManifest.tableSummaries[key] = { ...tableManifest.tableSummaries[key], header, totalRows: 1 };
  useProjectStore().registerProjectManifest(tableManifest);
  tables.initializeModTables({ sessionId: tableManifest.sessionId, modRoot: root, manifest: tableManifest });
  tables.applyTableIndex(
    target,
    csvTableIndex([{ rowKey: 'ships:new:0', isComment: false, data: { width: '1' } }], {
      table: 'ships',
      baseVersions: [],
      header: ['width'],
      totalRows: 1,
    }),
  );
  const inputs = tables.getTableInputs(root, 'ships');
  const grid = computed(() => {
    const model = createCsvGridColumns(
      'ships',
      header,
      tables.rows.filter((row) => row !== null),
    );
    model.columns[0]!.schema = { key: 'width', control };
    return { ...model, rowKeys: tables.rowKeys, rowsByKey: tables.rowsByKey };
  });
  const wrapper = mount(
    {
      setup() {
        provideCsvTableInputs({ target, inputs, activate: (cell) => tables.setActiveCell(cell, root), update: tables.updateCellValue });
        return () =>
          h(CsvGrid, {
            model: grid.value,
            editing: tables.editing,
            selectedRowKey: tables.selectedRowKey,
            isDirty: tables.isDirty,
            onSelectRow: (rowKey: string | null) => tables.selectRowByKey(target, rowKey),
          });
      },
    },
    { global: { stubs: editorUiStubs }, attachTo: document.body },
  );
  return { root, tables, inputs, wrapper };
}

describe('CSV input, target and row lifecycle', () => {
  it('keeps the active input and anchor when horizontal scrolling changes the visible columns', async () => {
    const { inputs, wrapper } = mountTable('number', 8);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    const input = wrapper.get('input.csv-cell-input');
    const anchor = wrapper.get('[data-column-key="width"]').element;
    await input.setValue('pending');
    const panel = wrapper.get('.table-panel');
    panel.element.scrollLeft = 600;
    await panel.trigger('scroll');
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="field7"]').exists()).toBe(true));
    expect(wrapper.get('[data-column-key="width"]').element).toBe(anchor);
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect(inputs.dirty.value).toBe(true);
    expect(input.element).toHaveProperty('value', 'pending');
    expect(wrapper.find('[data-column-key="field0"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('commits the previous raw input before another row takes the single editor', async () => {
    const { root, tables, inputs, wrapper } = mountTable();
    const mapping = [{ previousKey: 'ships:new:0', nextKey: 'ships:row:9', rowIndex: 9 }];
    applySavedCsvRowKeyMapDraft(tables.getCsvModState(root)!.documents.ships, mapping);
    tables.applySavedRowKeyMap(root, 'ships', mapping);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-row-key="ships:row:9"] [data-column-key="width"]').trigger('click');
    const input = wrapper.get('input.csv-cell-input');
    const editor = wrapper.get('.csv-cell-editor').element;
    await input.setValue('0012');
    const next = tables.addNewRow()!;
    await vi.waitFor(() => expect(wrapper.find(`[data-row-key="${next.rowKey}"]`).exists()).toBe(true));
    await wrapper.get(`[data-row-key="${next.rowKey}"] [data-column-key="width"]`).trigger('click');
    await vi.waitFor(() => expect(tables.editing?.rowKey).toBe(next.rowKey));
    expect(tables.rowsByKey['ships:row:9']?.data.width).toBe('0012');
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect(wrapper.get('.csv-cell-editor').element).toBe(editor);
    expect(wrapper.findAll('.csv-cell-editor')).toHaveLength(1);
    expect(inputs.dirty.value).toBe(false);
    await wrapper.get('input.csv-cell-input').setValue('canceled');
    await wrapper.get('input.csv-cell-input').trigger('keydown', { key: 'Escape' });
    expect(tables.rowsByKey[next.rowKey]?.data.width).toBe('');
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
    expect(inputs.commit()).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps the editor and its anchor when the effective input mode changes', async () => {
    const { wrapper } = mountTable('enum');
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    const anchor = wrapper.get('.csv-cell-frame').element;
    const editor = wrapper.get('.csv-cell-editor').element;
    useSettingsStore().setEditMode('smart');
    await nextTick();
    await nextTick();
    expect(wrapper.get('.csv-cell-frame').element).toBe(anchor);
    expect(anchor.querySelector('.csv-cell-editor')).toBe(editor);
    expect(wrapper.find('.csv-cell-picker').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the same raw control across rowKey mapping and commits to the saved identity', async () => {
    const { root, tables, inputs, wrapper } = mountTable();
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    const input = wrapper.get('input.csv-cell-input');
    await input.setValue('0012');
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(root)).toBe(true);
    expect(tables.rows[0]?.data.width).toBe('1');
    const mapping = [{ previousKey: 'ships:new:0', nextKey: 'ships:row:9', rowIndex: 9 }];
    applySavedCsvRowKeyMapDraft(tables.getCsvModState(root)!.documents.ships, mapping);
    tables.applySavedRowKeyMap(root, 'ships', mapping);
    await nextTick();
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe('0012');
    await inputs.commit();
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect(wrapper.get('[data-column-key="width"]').classes()).toContain('dirty');
    expect(tables.rows[0]?.rowKey).toBe('ships:row:9');
    expect(tables.rows[0]?.data.width).toBe('0012');
    expect(await tables.activeEditor!.undo()).toBe(true);
    await nextTick();
    expect(wrapper.get('input.csv-cell-input').element).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe('1');
    expect(wrapper.get('[data-column-key="width"]').classes()).not.toContain('dirty');
    expect(tables.rows[0]?.data.width).toBe('1');
    expect(tables.activeEditor!.canUndo.value).toBe(false);
    wrapper.unmount();
  });

  it('retains the active raw editor while scrolling and preserves external updates while raw input is dirty', async () => {
    const { tables, inputs, wrapper } = mountTable();
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('input.csv-cell-input').setValue('later');
    tables.applyTableIndex(
      { sessionId: 'sA', modRoot: 'M:/A', table: 'ships' },
      csvTableIndex([{ rowKey: 'ships:new:0', isComment: false, data: { width: 'external' } }], {
        table: 'ships',
        baseVersions: [],
        header: ['width'],
        totalRows: 1,
      }),
    );
    expect(tables.rows[0]?.data.width).toBe('1');
    expect(tables.hasCurrentTableExternalUpdate).toBe(true);
    await wrapper.get('.table-panel').trigger('scroll');
    await nextTick();
    expect(tables.rows[0]?.data.width).toBe('1');
    expect(tables.editing?.column).toBe('width');
    expect(inputs.dirty.value).toBe(true);
    expect((wrapper.get('input.csv-cell-input').element as HTMLInputElement).value).toBe('later');
    wrapper.unmount();
  });
});
