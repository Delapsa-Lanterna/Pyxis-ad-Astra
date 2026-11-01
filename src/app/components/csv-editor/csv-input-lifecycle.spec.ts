import { csvTableIndex } from '@/test/fixtures/csv-row';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvGrid from './CsvGrid.vue';
import { createCsvGridColumns } from '@/domain/csv-editor/csv-grid-model';
import { provideCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { TABLE_KEYS } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { applySavedCsvRowKeyMapDraft } from '@/domain/csv-editor/csv-table-draft';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import type { CsvColumnControl } from '@/domain/schema/schema.types';

const bulkMocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), error: vi.fn(), images: vi.fn() }));
vi.mock('@/shared/runtime/clipboard.runtime', () => ({ readClipboardText: bulkMocks.read, writeClipboardText: bulkMocks.write }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(), error: bulkMocks.error }) }));
vi.mock('@/services/source-options.service', () => ({ queryImageSourceOptions: bulkMocks.images }));

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
  vi.clearAllMocks();
  bulkMocks.images.mockResolvedValue([]);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as CanvasRenderingContext2D);
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

function mountTable(control: CsvColumnControl = 'number', extraColumns = 0, count = 1, loaded = count) {
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
    csvTableIndex(
      Array.from({ length: loaded }, (_, index) => ({
        rowKey: index ? 'ships:row:' + index : 'ships:new:0',
        isComment: false,
        data: { width: String(index + 1) },
      })),
      {
        table: 'ships',
        baseVersions: [],
        header,
        totalRows: count,
        rowKeys: Array.from({ length: count }, (_, index) => (index ? 'ships:row:' + index : 'ships:new:0')),
      },
    ),
  );
  const inputs = tables.getTableInputs(root, 'ships');
  const update = vi.spyOn(tables, 'updateCellValue');
  tables.getCsvModState(root)!.documents.ships.nextRowKey = 1;
  const load = vi.fn(async (keys: string[]) => keys.every((key) => Boolean(tables.rowsByKey[key])));
  const writeRange = vi.fn((keys: string[], columns: string[], values: string[][]) => tables.updateRange(target, keys, columns, values));
  const rowActions = {
    move: vi.fn((keys: string[], boundary: number) => tables.moveRows(target, keys, boundary)),
    copy: vi.fn((keys: string[], boundary: number) => tables.copyRows(target, keys, boundary)),
    remove: vi.fn((keys: string[]) => tables.deleteRows(target, keys)),
    insert: vi.fn((columns: string[], values: string[][], boundary: number) =>
      tables.insertRows(
        target,
        values.map((row) => ({
          rowKey: '',
          data: Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])),
          isComment: false,
        })),
        boundary,
      ),
    ),
  };
  const grid = computed(() => {
    const model = createCsvGridColumns(
      'ships',
      header,
      tables.rows.filter((row) => row !== null),
    );
    model.columns[0]!.schema = { key: 'width', control, imageDirectories: control === 'path-image' ? ['graphics/test'] : undefined };
    return { ...model, rowKeys: tables.rowKeys, rowsByKey: tables.rowsByKey };
  });
  const wrapper = mount(
    {
      setup() {
        provideCsvTableInputs({
          target,
          inputs,
          activate: (cell) => tables.setActiveCell(cell, root),
          update: tables.updateCellValue,
          range: {
            load,
            update: writeRange,
            revision: () => JSON.stringify(tables.getCsvModState(root)!.documents.ships.baseVersions),
            disabled: () => tables.saving || tables.currentTableLocked,
            ...rowActions,
            position: (key, after = false) => tables.getCsvModState(root)!.documents.ships.rowOrder.indexOf(key) + Number(after),
          },
        });
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
  return { root, tables, inputs, wrapper, target, load, writeRange, rowActions, update };
}

async function clickRow(wrapper: ReturnType<typeof mount>, key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const panel = wrapper.get('.table-panel').element;
  Object.assign(panel, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  const event = (type: string) => {
    const value = new MouseEvent(type, { button: 0, clientX: 10, clientY: 30, bubbles: true, ...modifiers });
    Object.defineProperty(value, 'pointerId', { value: 7 });
    return value;
  };
  wrapper.get(`[data-row-key="${key}"] .csv-row-handle`).element.dispatchEvent(event('pointerdown'));
  await flushPromises();
  panel.dispatchEvent(event('pointerup'));
  await flushPromises();
}

describe('CSV input, target and row lifecycle', () => {
  it.each(['arrow', 'raw'])('confirms a keyboard candidate from %s with one update and stays on its cell', async (entry) => {
    const { wrapper, tables, update, inputs } = mountTable('boolean', 1, 2);
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger(entry === 'raw' ? 'dblclick' : 'click');
    if (entry === 'arrow') await wrapper.get('[data-csv-picker]').trigger('click');
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
    if (entry === 'raw') await input.setValue('');
    for (let i = 0; i < 2; i++) await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('.csv-cell-picker-option.active').text()).toBe('FALSE');
    expect(input.element.value).toBe('');
    expect(document.activeElement).toBe(input.element);
    expect(update).toHaveBeenCalledTimes(0);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(0);
    if (entry === 'arrow') expect(inputs.dirty.value).toBe(false);
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ column: 'width' }), 'FALSE');
    expect(tables.selectedRowKey).toBe('ships:new:0');
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    expect(wrapper.find('.csv-cell-picker').exists()).toBe(false);
    await tables.activeEditor!.undo();
    expect(tables.rows[0]!.data.width).toBe('1');
    wrapper.unmount();
  });
  it.each(['Enter', 'Tab', 'Escape', 'Control+Enter'])('returns to raw input or settles pending navigation through %s', async (key) => {
    const { wrapper, tables, update, writeRange } = mountTable('boolean', 1, 2);
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
    const input = wrapper.get('.csv-cell-picker-search');
    await input.setValue('');
    await input.trigger('keydown', { key: 'ArrowDown' });
    if (key === 'Enter') await input.setValue(' literal ');
    await input.trigger('keydown', { key: key.replace('Control+', ''), ctrlKey: key.startsWith('Control+') });
    await flushPromises();
    expect(tables.rows[0]!.data.width).toBe(key === 'Escape' ? '1' : key === 'Enter' ? ' literal ' : '');
    expect(update).toHaveBeenCalledTimes(key === 'Enter' || key === 'Tab' ? 1 : 0);
    expect(writeRange).toHaveBeenCalledTimes(key === 'Control+Enter' ? 1 : 0);
    if (key === 'Enter') expect(tables.selectedRowKey).toBe('ships:row:1');
    wrapper.unmount();
  });
  it.each(['tags', 'multi'] as const)('toggles keyboard %s candidates and submits the complete edit once', async (control) => {
    const { wrapper, tables, update } = mountTable(control);
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
    const input = wrapper.get('.csv-cell-picker-search');
    await input.setValue('alpha, beta');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.get<HTMLInputElement>('.csv-cell-picker-search').element.value).toBe('alpha');
    expect(update).toHaveBeenCalledTimes(0);
    await wrapper.get('.csv-cell-picker-action').trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(1);
    expect(tables.rows[0]!.data.width).toBe('alpha');
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['arrow', 'F2'])('retains the arrow and commits once when closing a dropdown opened through %s', async (entry) => {
    const { wrapper, tables, update } = mountTable('reference');
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    const arrow = wrapper.get('[data-csv-picker]');
    await wrapper.get('[data-column-key="width"]').trigger('click');
    if (entry === 'arrow') await arrow.trigger('click');
    else await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    await flushPromises();
    if (entry === 'F2') await wrapper.get('.csv-cell-picker-search').setValue('updated');
    await arrow.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-csv-picker]').element).toBe(arrow.element);
    expect(wrapper.find('.csv-cell-picker').exists()).toBe(false);
    expect(update).toHaveBeenCalledTimes(entry === 'F2' ? 1 : 0);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(entry === 'F2' ? 1 : 0);
    wrapper.unmount();
  });
  describe.each(['reference', 'boolean', 'enum', 'tags', 'multi', 'path-image'] as const)('Smart %s raw dropdown', (control) => {
    it.each(['second', 'double', 'F2', 'typing', 'composition'])('edits from %s with one update and one history entry', async (entry) => {
      const { wrapper, tables, inputs, update } = mountTable(control, 1, 2);
      useSettingsStore().setEditMode('smart');
      await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
      const cell = wrapper.get('[data-column-key="width"]');
      await cell.trigger('click');
      expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
      if (entry === 'second' || entry === 'double') await cell.trigger(entry === 'second' ? 'click' : 'dblclick', { clientX: 14 });
      else {
        const sink = wrapper.get<HTMLTextAreaElement>('.csv-cell-selection-input');
        if (entry === 'F2') await sink.trigger('keydown', { key: 'F2' });
        else {
          if (entry === 'composition') await sink.trigger('compositionstart');
          await sink.setValue(entry === 'composition' ? '文字' : 'typed');
          if (entry === 'composition') {
            expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
            await sink.trigger('compositionend');
          }
        }
      }
      await flushPromises();
      const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
      expect(document.activeElement).toBe(input.element);
      expect(input.element.value).toBe(entry === 'typing' ? 'typed' : entry === 'composition' ? '文字' : '1');
      if (entry === 'F2') expect(input.element.selectionStart).toBe(1);
      const value = ' 001,  beta ';
      await input.setValue(value);
      expect(inputs.dirty.value).toBe(true);
      expect(update).toHaveBeenCalledTimes(0);
      expect(bulkMocks.images).toHaveBeenCalledTimes(control === 'path-image' ? 1 : 0);
      await input.trigger('keydown', { key: 'Enter', isComposing: true });
      expect(update).toHaveBeenCalledTimes(0);
      await input.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rowKey: 'ships:new:0', column: 'width' }), value);
      expect(tables.selectedRowKey).toBe('ships:row:1');
      expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
      await tables.activeEditor!.undo();
      expect(tables.rows[0]!.data.width).toBe('1');
      await tables.activeEditor!.redo();
      expect(tables.rows[0]!.data.width).toBe(value);
      expect(update).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });
  });
  it('keeps raw list edits and candidate toggles in one pending submission', async () => {
    const { wrapper, tables, update } = mountTable('tags');
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
    await input.setValue('alpha, beta');
    await wrapper.findAll('.csv-cell-picker-option')[1]!.trigger('click');
    expect(input.element.value).toBe('alpha');
    expect(update).toHaveBeenCalledTimes(0);
    await wrapper.get('.csv-cell-picker-action').trigger('click');
    await flushPromises();
    expect(tables.rows[0]!.data.width).toBe('alpha');
    expect(update).toHaveBeenCalledTimes(1);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['Enter', 'Shift+Enter', 'Tab', 'Shift+Tab', 'cell', 'blank', 'save', 'Escape'])(
    'settles dropdown raw text through %s',
    async (entry) => {
      const { wrapper, tables, inputs, update, target, root } = mountTable('multi', 1, 2);
      useSettingsStore().setEditMode('smart');
      await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="width"]').exists()).toBe(true));
      await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="width"]').trigger('dblclick');
      await flushPromises();
      const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
      await input.setValue('');
      if (entry === 'save') {
        const mapping = [{ previousKey: 'ships:row:1', nextKey: 'ships:row:9', rowIndex: 1 }];
        applySavedCsvRowKeyMapDraft(tables.getCsvModState(root)!.documents.ships, mapping);
        tables.applySavedRowKeyMap(root, 'ships', mapping);
        await flushPromises();
        expect(wrapper.get('.csv-cell-picker-search').element).toBe(input.element);
        await inputs.commit();
      } else if (entry === 'cell') await wrapper.get('[data-column-key="width"]').trigger('click');
      else if (entry === 'blank') await wrapper.get('.table-panel').trigger('mousedown');
      else await input.trigger('keydown', { key: entry.replace('Shift+', ''), shiftKey: entry.startsWith('Shift+') });
      await flushPromises();
      expect(update).toHaveBeenCalledTimes(entry === 'Escape' ? 0 : 1);
      expect(tables.getCsvModState(root)!.documents.ships.history.undoStack).toHaveLength(entry === 'Escape' ? 0 : 1);
      expect(tables.rows[1]!.data.width).toBe(entry === 'Escape' ? '2' : '');
      if (entry === 'save') expect(update).toHaveBeenCalledExactlyOnceWith({ ...target, rowKey: 'ships:row:9', column: 'width' }, '');
      if (entry === 'Shift+Enter') expect(tables.selectedRowKey).toBe('ships:new:0');
      if (entry === 'Tab' || entry === 'Shift+Tab') expect(wrapper.get('.csv-cell-selected').attributes('data-column-key')).toBe('field0');
      wrapper.unmount();
    },
  );
  it('fills dropdown raw text once and keeps the range through undo and redo', async () => {
    const { wrapper, tables, writeRange, update, load } = mountTable('tags', 1, 2);
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="field0"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="field0"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="width"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    const input = wrapper.get('.csv-cell-picker-search');
    await input.setValue(' alpha,  beta ');
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(update).toHaveBeenCalledTimes(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(writeRange).toHaveBeenCalledExactlyOnceWith(
      ['ships:new:0', 'ships:row:1'],
      ['width', 'field0'],
      [
        [' alpha,  beta ', ' alpha,  beta '],
        [' alpha,  beta ', ' alpha,  beta '],
      ],
    );
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(4);
    await tables.activeEditor!.undo();
    expect(tables.rows.map((row) => row!.data.width)).toEqual(['1', '2']);
    await tables.activeEditor!.redo();
    expect(tables.rows.map((row) => row!.data.width)).toEqual([' alpha,  beta ', ' alpha,  beta ']);
    expect(writeRange).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it.each(['number', 'text', 'reference'] as const)('opens %s on a second separate click and commits once', async (control) => {
    const { wrapper, tables } = mountTable(control);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    const cell = wrapper.get('[data-column-key="width"]');
    await cell.trigger('click');
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
    await cell.trigger('click');
    const input = wrapper.get('.csv-cell-input, .csv-cell-text-input');
    await input.setValue('changed');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(tables.rows[0]!.data.width).toBe('changed');
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it.each([false, true])('submits one complete drag with Ctrl=%s and loads only copies', async (ctrl) => {
    const { wrapper, tables, load, rowActions } = mountTable('number', 1, 4);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:3"]').exists()).toBe(true));
    await clickRow(wrapper, 'ships:new:0');
    await clickRow(wrapper, 'ships:row:2', { ctrlKey: true });
    const event = (type: string, y: number) => {
      const value = new MouseEvent(type, { button: 0, clientX: 10, clientY: y, ctrlKey: ctrl, bubbles: true });
      Object.defineProperty(value, 'pointerId', { value: 7 });
      return value;
    };
    wrapper.get('[data-row-key="ships:new:0"] .csv-row-handle').element.dispatchEvent(event('pointerdown', 30));
    await flushPromises();
    const panel = wrapper.get('.table-panel').element;
    panel.dispatchEvent(event('pointermove', 119));
    panel.dispatchEvent(event('pointerup', 119));
    await flushPromises();
    expect(ctrl ? rowActions.copy : rowActions.move).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:2'], 4);
    expect(ctrl ? rowActions.move : rowActions.copy).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(ctrl ? 1 : 0);
    expect(tables.totalRowCount).toBe(ctrl ? 6 : 4);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    await tables.activeEditor!.undo();
    expect(tables.rows.map((row) => row!.data.width)).toEqual(['1', '2', '3', '4']);
    wrapper.unmount();
  });
  it('selects disjoint complete rows and copies them once in display order', async () => {
    const { wrapper, load, rowActions } = mountTable('number', 1, 4);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:3"]').exists()).toBe(true));
    await clickRow(wrapper, 'ships:row:2');
    await clickRow(wrapper, 'ships:new:0', { ctrlKey: true });
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(4);
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'c', ctrlKey: true });
    await flushPromises();
    expect(load).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:2']);
    expect(bulkMocks.write).toHaveBeenCalledExactlyOnceWith('1\t\r\n3\t\r\n');
    expect(rowActions.copy).not.toHaveBeenCalled();
    await clickRow(wrapper, 'ships:row:3', { shiftKey: true });
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(8);
    wrapper.unmount();
  });
  it('toggles the last selected row off and clears its highlight', async () => {
    const { wrapper, tables } = mountTable();
    await vi.waitFor(() => expect(wrapper.find('.csv-row-handle').exists()).toBe(true));
    await clickRow(wrapper, 'ships:new:0');
    await clickRow(wrapper, 'ships:new:0', { ctrlKey: true });
    expect(tables.selectedRowKey).toBeNull();
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(0);
    wrapper.unmount();
  });
  it.each(['keyboard', 'toolbar'])('deletes selected records once from %s and restores their positions', async (entry) => {
    const { wrapper, tables, rowActions, load } = mountTable('number', 1, 4);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:3"]').exists()).toBe(true));
    await clickRow(wrapper, 'ships:new:0');
    await clickRow(wrapper, 'ships:row:2', { ctrlKey: true });
    if (entry === 'keyboard') await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: '-', ctrlKey: true });
    else expect(await wrapper.getComponent(CsvGrid).vm.deleteRows()).toBe(true);
    await flushPromises();
    expect(load).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:2']);
    expect(rowActions.remove).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:2']);
    expect(tables.totalRowCount).toBe(2);
    expect(tables.rows.map((row) => row!.data.width)).toEqual(['2', '4']);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    await tables.activeEditor!.undo();
    expect(tables.rows.map((row) => row!.data.width)).toEqual(['1', '2', '3', '4']);
    expect(rowActions.remove).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('keeps selected records when Delete clears their fields', async () => {
    const { wrapper, tables, rowActions, writeRange } = mountTable('number', 1, 3);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:2"]').exists()).toBe(true));
    await clickRow(wrapper, 'ships:new:0');
    await clickRow(wrapper, 'ships:row:2', { ctrlKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(writeRange).toHaveBeenCalledExactlyOnceWith(
      ['ships:new:0', 'ships:row:2'],
      ['width', 'field0'],
      [
        ['', ''],
        ['', ''],
      ],
    );
    expect(rowActions.remove).not.toHaveBeenCalled();
    expect(tables.totalRowCount).toBe(3);
    expect(tables.rows[1]!.data.width).toBe('2');
    wrapper.unmount();
  });
  it('retains overwrite semantics when pasting after complete-row selection', async () => {
    const { wrapper, tables, rowActions } = mountTable('number', 1, 3);
    bulkMocks.read.mockResolvedValueOnce('A\tB\nC\tD');
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:2"]').exists()).toBe(true));
    await clickRow(wrapper, 'ships:new:0');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await flushPromises();
    expect(tables.totalRowCount).toBe(3);
    expect(tables.rows.slice(0, 2).map((row) => row!.data)).toEqual([
      { width: 'A', field0: 'B' },
      { width: 'C', field0: 'D' },
    ]);
    expect(rowActions.insert).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('copies raw rectangular values once without submitting an edit', async () => {
    const { wrapper, tables, load, writeRange, inputs } = mountTable('number', 1, 3);
    const commit = vi.spyOn(inputs, 'commit');
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="field0"]').exists()).toBe(true));
    tables.rowsByKey['ships:new:0']!.data.field0 = '001';
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'c', ctrlKey: true });
    await flushPromises();
    expect(load).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:1']);
    expect(bulkMocks.write).toHaveBeenCalledExactlyOnceWith('1\t001\r\n2\t\r\n');
    expect(writeRange).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it('pastes its actual footprint and appends blank rows in one submission and one history entry', async () => {
    const { wrapper, tables, writeRange, load } = mountTable('number', 2, 2);
    bulkMocks.read.mockResolvedValueOnce('001\tA\n002\tB\n003\tC');
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await flushPromises();
    expect(bulkMocks.read).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledExactlyOnceWith(['ships:row:1']);
    expect(writeRange).toHaveBeenCalledOnce();
    expect(tables.totalRowCount).toBe(4);
    expect(tables.rows.slice(1).map((row) => row?.data)).toEqual([
      { width: '001', field0: 'A' },
      { width: '002', field0: 'B', field1: '' },
      { width: '003', field0: 'C', field1: '' },
    ]);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    await vi.waitFor(() => expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(6));
    await tables.activeEditor!.undo();
    expect(tables.totalRowCount).toBe(2);
    await tables.activeEditor!.redo();
    expect(tables.totalRowCount).toBe(4);
    expect(writeRange).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
  it('pastes one cell into the top-left without repeating it across a larger selection', async () => {
    const { wrapper, tables, writeRange } = mountTable('number', 1, 2);
    bulkMocks.read.mockResolvedValueOnce('500');
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await flushPromises();
    expect(writeRange).toHaveBeenCalledExactlyOnceWith(['ships:new:0'], ['width'], [['500']]);
    expect(tables.rows[1]!.data.width).toBe('2');
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(1);
    wrapper.unmount();
  });
  it.each(['Delete', 'd', 'r'])('applies %s to one batch and restores the original values', async (key) => {
    const { wrapper, tables, writeRange } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    tables.rowsByKey['ships:new:0']!.data.field0 = 'X';
    tables.rowsByKey['ships:row:1']!.data.field0 = 'Y';
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key, ctrlKey: key !== 'Delete' });
    await flushPromises();
    expect(writeRange).toHaveBeenCalledOnce();
    expect(tables.rows.map((row) => [row!.data.width, row!.data.field0])).toEqual(
      key === 'Delete'
        ? [
            ['', ''],
            ['', ''],
          ]
        : key === 'd'
          ? [
              ['1', 'X'],
              ['1', 'X'],
            ]
          : [
              ['1', '1'],
              ['2', '2'],
            ],
    );
    await tables.activeEditor!.undo();
    expect(tables.rows.map((row) => [row!.data.width, row!.data.field0])).toEqual([
      ['1', 'X'],
      ['2', 'Y'],
    ]);
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.redoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it('fills the entered text as one batch without an intermediate single-cell commit', async () => {
    const { wrapper, tables, writeRange } = mountTable('number', 1, 2);
    const single = vi.spyOn(tables, 'updateCellValue');
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    await wrapper.get('.csv-cell-text-input').setValue('001');
    await wrapper.get('.csv-cell-text-input').trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(single).not.toHaveBeenCalled();
    expect(writeRange).toHaveBeenCalledExactlyOnceWith(
      ['ships:new:0', 'ships:row:1'],
      ['width', 'field0'],
      [
        ['001', '001'],
        ['001', '001'],
      ],
    );
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it('cancels a late paste after selection changes and suppresses repeated clipboard reads', async () => {
    const { wrapper, writeRange, load } = mountTable('number', 1, 2);
    let finish!: (value: string) => void;
    bulkMocks.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    for (let i = 0; i < 2; i++) await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="width"]').trigger('click');
    finish('late');
    await flushPromises();
    expect(bulkMocks.read).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(writeRange).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('reports column overflow once before any content read or submission', async () => {
    const { wrapper, load, writeRange } = mountTable();
    bulkMocks.read.mockResolvedValueOnce('A\tB');
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await flushPromises();
    expect(bulkMocks.error).toHaveBeenCalledExactlyOnceWith('粘贴需要 2 列，当前位置剩余 1 列');
    expect(load).not.toHaveBeenCalled();
    expect(writeRange).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('preserves later text typed while a fill waits for its rows', async () => {
    const { wrapper, tables, load, writeRange } = mountTable('number', 1, 2);
    let finish!: (value: boolean) => void;
    load.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click', { shiftKey: true });
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    const input = wrapper.get<HTMLTextAreaElement>('.csv-cell-text-input');
    await input.setValue('captured');
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await input.setValue('later');
    finish(true);
    await flushPromises();
    expect(writeRange).not.toHaveBeenCalled();
    expect(tables.rows[1]!.data.field0).toBeUndefined();
    expect(input.element.value).toBe('later');
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(true);
    wrapper.unmount();
  });
  it.each(['d', 'r'])('fills a single cell using its neighbor with Ctrl+%s', async (key) => {
    const { wrapper, tables, load, writeRange } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="field0"]').exists()).toBe(true));
    tables.rowsByKey['ships:new:0']!.data.field0 = 'source';
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key, ctrlKey: true });
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    expect(writeRange).toHaveBeenCalledTimes(1);
    expect(writeRange.mock.calls[0]).toEqual([['ships:row:1'], ['field0'], [[key === 'd' ? 'source' : '2']]]);
    expect(tables.rows[1]!.data.field0).toBe(key === 'd' ? 'source' : '2');
    wrapper.unmount();
  });
  it('uses only filtered rows and appends overflow to the complete table end', async () => {
    const { wrapper, tables, writeRange } = mountTable('number', 1, 4);
    const document = tables.getCsvModState('M:/A')!.documents.ships;
    document.queryRowKeys = ['ships:new:0', 'ships:row:2'];
    document.filteredRowCount = 2;
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:2"] [data-column-key="width"]').exists()).toBe(true));
    bulkMocks.read.mockResolvedValueOnce('100\n200\n300');
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'v', ctrlKey: true });
    await flushPromises();
    expect(writeRange).toHaveBeenCalledExactlyOnceWith(['ships:new:0', 'ships:row:2'], ['width'], [['100'], ['200'], ['300']]);
    expect(document.rowOrder).toHaveLength(5);
    expect(document.queryRowKeys).toEqual(['ships:new:0', 'ships:row:2', document.rowOrder[4]]);
    expect(document.rows['ships:row:1']!.data.width).toBe('2');
    expect(document.rows['ships:row:3']!.data.width).toBe('4');
    wrapper.unmount();
  });
  it('cycles both ways inside a rectangle and extends from the original anchor', async () => {
    const { wrapper, tables } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="field0"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    for (const key of ['ArrowRight', 'ArrowDown'])
      await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key, shiftKey: true });
    expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(4);
    for (const [key, shiftKey, row, col] of [
      ['Tab', false, 'ships:new:0', 'width'],
      ['Enter', false, 'ships:row:1', 'width'],
      ['Enter', false, 'ships:new:0', 'field0'],
      ['Tab', true, 'ships:new:0', 'width'],
    ] as const) {
      await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key, shiftKey });
      await flushPromises();
      expect(tables.selectedRowKey).toBe(row);
      expect(wrapper.get('.csv-cell-selected').attributes('data-column-key')).toBe(col);
      expect(wrapper.findAll('.csv-cell-in-range')).toHaveLength(4);
    }
    wrapper.unmount();
  });
  it.each(['save', 'baseline', 'unmount', 'edit'])('ends a pending range read on %s without a submission', async (boundary) => {
    const { wrapper, tables, load, writeRange, target } = mountTable('number', 1, 2);
    let finish!: (value: boolean) => void;
    load.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    if (boundary === 'save') tables.setSaving(target, true);
    if (boundary === 'baseline')
      tables.getCsvModState(target.modRoot)!.documents.ships.baseVersions = [{ path: 'ships.csv', fingerprint: 'changed' }];
    if (boundary === 'unmount') wrapper.unmount();
    if (boundary === 'edit') await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    finish(true);
    await flushPromises();
    expect(load).toHaveBeenCalledOnce();
    expect(writeRange).not.toHaveBeenCalled();
    expect(bulkMocks.error).not.toHaveBeenCalled();
    if (boundary !== 'unmount') wrapper.unmount();
  });
  it.each(['number', 'text', 'reference', 'boolean', 'enum', 'tags', 'multi', 'path-image'] as const)(
    'selects %s before F2 edits its raw value',
    async (control) => {
      const { wrapper, tables } = mountTable(control);
      useSettingsStore().setEditMode('smart');
      await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
      await wrapper.get('[data-column-key="width"]').trigger('click');
      expect(wrapper.get('[data-column-key="width"]').attributes('aria-selected')).toBe('true');
      expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
      expect(tables.editing).toBeNull();
      await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
      const input = wrapper.get<HTMLInputElement | HTMLTextAreaElement>('.csv-cell-input, .csv-cell-text-input, .csv-cell-picker-search');
      expect(input.element.value).toBe('1');
      expect(input.element.selectionStart).toBe(1);
      expect(wrapper.find('.csv-cell-picker').exists()).toBe(!['number', 'text'].includes(control));
      await input.setValue('001.50');
      await input.trigger('keydown', { key: 'Escape' });
      expect(tables.rows[0]?.data.width).toBe('1');
      expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
      wrapper.unmount();
    },
  );
  it.each(['reference', 'boolean', 'enum', 'tags', 'multi', 'path-image'] as const)(
    'opens %s with an empty search through its candidate arrow',
    async (control) => {
      const { wrapper, inputs } = mountTable(control);
      useSettingsStore().setEditMode('smart');
      await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
      await wrapper.get('[data-column-key="width"]').trigger('click');
      expect(wrapper.find('.csv-cell-picker').exists()).toBe(false);
      await wrapper.get('[data-csv-picker]').trigger('click');
      await flushPromises();
      expect(wrapper.find('.csv-cell-picker').exists()).toBe(true);
      expect(wrapper.get<HTMLInputElement>('.csv-cell-picker-search').element.value).toBe('');
      expect(inputs.dirty.value).toBe(false);
      await wrapper.get('.csv-cell-picker-search').trigger('keydown', { key: 'Escape' });
      expect(wrapper.get('[data-column-key="width"]').attributes('aria-selected')).toBe('true');
      wrapper.unmount();
    },
  );
  it.each([
    ['ArrowDown', false, 'ships:row:1', 'width'],
    ['ArrowUp', false, 'ships:new:0', 'width'],
    ['ArrowRight', false, 'ships:new:0', 'field0'],
    ['ArrowLeft', false, 'ships:new:0', 'width'],
    ['Enter', false, 'ships:row:1', 'width'],
    ['Enter', true, 'ships:new:0', 'width'],
    ['Tab', false, 'ships:new:0', 'field0'],
    ['Tab', true, 'ships:new:0', 'width'],
  ])('navigates %s with Shift=%s', async (key, shiftKey, row, column) => {
    const { wrapper } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key, shiftKey });
    await flushPromises();
    const selected = wrapper.get('.csv-cell-selected');
    expect(selected.attributes('data-column-key')).toBe(column);
    expect(selected.element.closest<HTMLElement>('[data-row-key]')!.dataset.rowKey).toBe(row);
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
    wrapper.unmount();
  });
  it('wraps Tab at row edges and commits one edit before moving', async () => {
    const { wrapper, tables } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="field0"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="field0"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'Tab' });
    await flushPromises();
    expect(tables.selectedRowKey).toBe('ships:row:1');
    expect(wrapper.get('.csv-cell-selected').attributes('data-column-key')).toBe('width');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'Tab', shiftKey: true });
    await flushPromises();
    expect(tables.selectedRowKey).toBe('ships:new:0');
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    await wrapper.get('.csv-cell-input').setValue('001');
    await wrapper.get('.csv-cell-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(tables.rows[0]?.data.width).toBe('001');
    expect(tables.selectedRowKey).toBe('ships:row:1');
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    wrapper.unmount();
  });
  it('keeps the table boundaries and leaves shortcuts in other inputs', async () => {
    const { wrapper, tables } = mountTable('number', 1, 2);
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] [data-column-key="field0"]').exists()).toBe(true));
    await wrapper.get('[data-row-key="ships:row:1"] [data-column-key="field0"]').trigger('click');
    for (const key of ['Tab', 'Enter', 'ArrowRight', 'ArrowDown'])
      await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key });
    await flushPromises();
    expect(tables.selectedRowKey).toBe('ships:row:1');
    expect(wrapper.get('.csv-cell-selected').attributes('data-column-key')).toBe('field0');
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
    outside.remove();
    wrapper.unmount();
  });
  it('commits confirmed multi values once when Tab moves to the next cell', async () => {
    const { wrapper, tables } = mountTable('multi', 1);
    useSettingsStore().setEditMode('smart');
    await vi.waitFor(() => expect(wrapper.find('[data-csv-picker]').exists()).toBe(true));
    await wrapper.get('[data-csv-picker]').trigger('click');
    await flushPromises();
    const search = wrapper.get('.csv-cell-picker-search');
    for (const value of ['Alpha', 'Beta']) {
      await search.setValue(value);
      await search.trigger('keydown', { key: 'Enter' });
    }
    await search.setValue('unconfirmed');
    await search.trigger('keydown', { key: 'Tab' });
    await flushPromises();
    expect(tables.rows[0]?.data.width).toBe('1, Alpha, Beta');
    expect(tables.getCsvModState('M:/A')!.documents.ships.history.undoStack).toHaveLength(1);
    expect(wrapper.get('.csv-cell-selected').attributes('data-column-key')).toBe('field0');
    wrapper.unmount();
  });
  it('retains composition until its completed text starts a single replacement edit', async () => {
    const { wrapper, tables } = mountTable();
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    const sink = wrapper.get<HTMLTextAreaElement>('.csv-cell-selection-input');
    await sink.trigger('compositionstart');
    await sink.setValue('中');
    expect(wrapper.find('.csv-cell-editor').exists()).toBe(false);
    sink.element.value = '中文';
    await sink.trigger('compositionend');
    const input = wrapper.get<HTMLInputElement>('.csv-cell-input');
    expect(input.element.value).toBe('中文');
    expect(tables.rows[0]?.data.width).toBe('1');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(tables.rows[0]?.data.width).toBe('1');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(tables.rows[0]?.data.width).toBe('中文');
    wrapper.unmount();
  });
  it('accepts a keyboard target loaded after navigation and maps its selection on save', async () => {
    const { wrapper, tables, target, root } = mountTable('number', 0, 2, 1);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('click');
    await wrapper.get('.csv-cell-selection-input').trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(tables.selectedRowKey).toBe('ships:row:1');
    tables.applyTableRows(target, {
      table: 'ships',
      baseVersions: [],
      rows: [{ rowKey: 'ships:row:1', isComment: false, data: { width: '2' } }],
    });
    await vi.waitFor(() => expect(wrapper.find('[data-row-key="ships:row:1"] .csv-cell-selected').exists()).toBe(true));
    const mapping = [{ previousKey: 'ships:row:1', nextKey: 'ships:row:9', rowIndex: 1 }];
    applySavedCsvRowKeyMapDraft(tables.getCsvModState(root)!.documents.ships, mapping);
    tables.applySavedRowKeyMap(root, 'ships', mapping);
    await flushPromises();
    expect(wrapper.find('[data-row-key="ships:row:9"] .csv-cell-selected').exists()).toBe(true);
    wrapper.unmount();
  });
  it('keeps the active input and anchor when horizontal scrolling changes the visible columns', async () => {
    const { inputs, wrapper } = mountTable('number', 8);
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
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
    await wrapper.get('[data-row-key="ships:row:9"] [data-column-key="width"]').trigger('dblclick');
    const input = wrapper.get('input.csv-cell-input');
    const editor = wrapper.get('.csv-cell-editor').element;
    await input.setValue('0012');
    const next = tables.addNewRow()!;
    await vi.waitFor(() => expect(wrapper.find(`[data-row-key="${next.rowKey}"]`).exists()).toBe(true));
    await wrapper.get(`[data-row-key="${next.rowKey}"] [data-column-key="width"]`).trigger('dblclick');
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
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
    const anchor = wrapper.get('.csv-cell-frame').element;
    const editor = wrapper.get('.csv-cell-editor').element;
    useSettingsStore().setEditMode('smart');
    await nextTick();
    await nextTick();
    expect(wrapper.get('.csv-cell-frame').element).toBe(anchor);
    expect(anchor.querySelector('.csv-cell-editor')).toBe(editor);
    expect(wrapper.get<HTMLInputElement>('.csv-cell-picker-search').element.value).toBe('1');
    wrapper.unmount();
  });

  it('keeps the same raw control across rowKey mapping and commits to the saved identity', async () => {
    const { root, tables, inputs, wrapper } = mountTable();
    await vi.waitFor(() => expect(wrapper.find('[data-column-key="width"]').exists()).toBe(true));
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
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
    await wrapper.get('[data-column-key="width"]').trigger('dblclick');
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
