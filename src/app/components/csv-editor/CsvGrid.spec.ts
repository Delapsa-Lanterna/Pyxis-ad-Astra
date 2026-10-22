import { csvDraftRow } from '@/test/csv-row';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import CsvGrid from './CsvGrid.vue';
import type { CsvGridModel } from '@/domain/csv-editor/csv-grid-model';
import { mountCsvInputHost } from '@/test/csv-input-host';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
let fixture: ReturnType<typeof mountCsvInputHost>;

let wrapper: VueWrapper | null = null;
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function modelFixture(): CsvGridModel {
  return {
    columns: [
      { className: 'schema-col-text', enumOptions: [], key: 'id', schema: null, widthPx: 100 },
      { className: 'schema-col-text', enumOptions: [], key: 'name', schema: null, widthPx: 100 },
    ],
    rowKeys: ['key-0'],
    rowsByKey: { 'key-0': csvDraftRow({ id: 's0' }, 'key-0') },
    sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
    totalWidthPx: 200,
  };
}

function mountGrid() {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  fixture = mountCsvInputHost(
    CsvGrid,
    {
      global: {
        stubs: {
          CsvGridHeader: {
            props: ['columns'],
            emits: ['resize-column'],
            template: '<thead class="header-stub" />',
          },
          CsvGridBody: {
            name: 'CsvGridBody',
            props: ['entries', 'columns'],
            emits: ['activate-cell', 'select-row'],
            template: `<div class="body-stub">
            <div
              v-for="row in entries.filter(entry => entry.kind === 'item')"
              :key="row.key"
              class="row-slot"
              @click="$emit('activate-cell', row.item, columns[0], $event)"
            >{{ row.item.rowKey }}</div>
          </div>`,
          },
        },
      },
      attachTo: document.body,
    },
    { isDirty: () => false, model: reactive(modelFixture()), selectedRowKey: null },
  );
  wrapper = fixture.host;
  return fixture.surface;
}

describe('CsvGrid', () => {
  it('refreshes the requested window and releases observation', async () => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.find('.row-slot').trigger('click');
    const requests = grid.emitted('request-window')!.length;
    resize();
    await grid.vm.$nextTick();
    expect(grid.emitted('request-window')!.length).toBeGreaterThan(requests);
    expect(fixture.activeCell.value).toMatchObject({ rowKey: 'key-0', column: 'id' });
    wrapper!.unmount();
    wrapper = null;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('emits the visible window size on mount so the store can load data', async () => {
    const grid = mountGrid();
    await grid.vm.$nextTick();
    const events = grid.emitted('request-window');
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.at(-1)).toEqual([0, expect.any(Number)]);
  });

  it('activates a cell: selects the row and exposes it through the editor host', async () => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.find('.row-slot').trigger('click');
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-0']);
    expect(grid.findComponent({ name: 'CsvGridEditorHost' }).props('target')).toMatchObject({ column: 'id', rowKey: 'key-0' });
  });

  it('keeps the active cell when the same target model is replaced', async () => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.find('.row-slot').trigger('click');
    expect(grid.findComponent({ name: 'CsvGridEditorHost' }).props('target')).not.toBeNull();

    fixture.props.value = { ...fixture.props.value, model: reactive(modelFixture()) };
    await grid.vm.$nextTick();
    expect(grid.findComponent({ name: 'CsvGridEditorHost' }).props('target')).toMatchObject({ rowKey: 'key-0', column: 'id' });
  });

  it('forwards selection from the body', async () => {
    const grid = mountGrid();
    const body = grid.findComponent({ name: 'CsvGridBody' });
    body.vm.$emit('select-row', 'key-1');
    await grid.vm.$nextTick();
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-1']);
  });

  it('keeps the current target when input validation rejects activation', async () => {
    const grid = mountGrid();
    const focus = vi.fn();
    fixture.inputs.register({ key: 'pending', label: 'Pending input', dirty: ref(true), commit: () => 'Invalid', focus, cancel: vi.fn() });
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get('.row-slot').trigger('click');
    await flushPromises();
    expect(focus).toHaveBeenCalledOnce();
    expect(fixture.activeCell.value).toBeNull();
    expect(grid.emitted('select-row')).toBeUndefined();
  });

  it('activates another field in the selected row without selecting that row again', async () => {
    const grid = mountGrid();
    fixture.props.value = { ...fixture.props.value, selectedRowKey: 'key-0' };
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get('.row-slot').trigger('click');
    expect(fixture.activeCell.value?.rowKey).toBe('key-0');
    expect(grid.emitted('select-row')).toBeUndefined();
  });
});
