import CsvGridEditorHost from '@/app/components/csv-editor/CsvGridEditorHost.vue';
import CsvGridBody from '@/app/components/csv-editor/CsvGridBody.vue';
import { csvDraftRow } from '@/test/fixtures/csv-row';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import CsvGrid from './CsvGrid.vue';
import CsvGridRow from './CsvGridRow.vue';
import type { CsvGridModel } from '@/domain/csv-editor/csv-grid-model';
import { mountCsvInputHost } from '@/test/unit/csv-input-host';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createCsvSourceIndex } from '@/domain/field-editor/csv-source-options';
import type { ResourceRef } from '@/shared/types';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
const { prepare, queryImages } = vi.hoisted(() => ({ prepare: vi.fn(), queryImages: vi.fn() }));
vi.mock('@/app/composables/use-thumbnail-preload', () => ({ useThumbnailPreload: () => ({ prepare, url: () => '' }) }));
vi.mock('@/services/csv-table.service', () => ({ queryCsvRowResources: queryImages }));
let fixture: ReturnType<typeof mountCsvInputHost>;

let wrapper: VueWrapper | null = null;
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.scrollLeft = options.left ?? this.scrollLeft;
    }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as CanvasRenderingContext2D);
  prepare.mockClear();
  queryImages.mockReset();
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
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

function mountGrid(model = modelFixture(), smart = false, anchored = false, real = false) {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editMode: smart ? 'smart' : 'plain' }));
  fixture = mountCsvInputHost(
    CsvGrid,
    {
      global: {
        components: { NCollapse, NCollapseItem },
        stubs: {
          ResourceThumbnail: true,
          CsvGridHeader: {
            props: ['columns'],
            emits: ['resize-column'],
            template: '<thead class="header-stub" />',
          },
          CsvGridBody: real
            ? false
            : {
                name: 'CsvGridBody',
                props: ['entries', 'columns'],
                emits: ['activate-cell', 'select-row', 'start-row-drag'],
                template: `<div class="body-stub">
            <div
              v-for="row in entries.filter(entry => entry.kind === 'item')"
              :key="row.key"
              class="row-slot"
              ${anchored ? ':data-row-key="row.item.rowKey"' : ''}
              @click="$emit('activate-cell', row.item, columns[0].column, $event)"
              @dblclick="$emit('activate-cell', row.item, columns[0].column, $event)"
            >${anchored ? '<div class="csv-grid-cell" data-column-key="id"><span class="csv-cell-frame">{{ row.item.rowKey }}<button data-csv-picker>Open</button></span></div>' : '{{ row.item.rowKey }}'}</div>
          </div>`,
              },
        },
      },
      attachTo: document.body,
    },
    {
      isDirty: () => false,
      model: reactive(model),
      selectedRowKey: null,
      onSelectRow: (rowKey: string) => {
        fixture.props.value = { ...fixture.props.value, selectedRowKey: rowKey };
      },
    },
    undefined,
    (editing) => ({ editing }),
  );
  wrapper = fixture.host;
  return fixture.surface;
}

describe('CsvGrid', () => {
  it('locates cells and repeats row-only location without changing content', async () => {
    const model = modelFixture();
    model.rowKeys = Array.from({ length: 20 }, (_, i) => 'key-' + i);
    model.rowsByKey = Object.fromEntries(model.rowKeys.map((key) => [key, csvDraftRow({ id: key }, key)]));
    const grid = mountGrid(model);
    wrapper!.getComponent(CsvGrid).vm.locate('key-19', 'name');
    await flushPromises();
    expect(fixture.props.value.selectedRowKey).toBe('key-19');
    expect(grid.find('.csv-cell-selection-input').exists()).toBe(true);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 264, behavior: 'smooth' });
    wrapper!.getComponent(CsvGrid).vm.locate('key-19');
    await flushPromises();
    expect(grid.find('.csv-cell-selection-input').exists()).toBe(false);
  });
  it.each([
    ['z', false, 'undo'],
    ['y', false, 'redo'],
    ['z', true, 'redo'],
  ] as const)('dispatches Ctrl+%s with Shift=%s from selection', async (key, shiftKey, command) => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get('.row-slot').trigger('click');
    await grid.get('.csv-cell-selection-input').trigger('keydown', { key, ctrlKey: true, shiftKey });
    expect(grid.emitted(command)).toHaveLength(1);
    expect(fixture.inputs.dirty.value).toBe(false);
  });
  it('commits the latest input before selecting rows for dragging', async () => {
    const grid = mountGrid();
    const panel = grid.get('.table-panel');
    Object.assign(panel.element, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    const commit = vi.fn(() => null);
    fixture.inputs.register({ key: 'raw', label: 'Raw', dirty: ref(true), commit, cancel: vi.fn(), focus: vi.fn() });
    grid.findComponent(CsvGridBody).vm.$emit('start-row-drag', 'key-0', {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 30,
      ctrlKey: true,
    });
    await flushPromises();
    const up = new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 45 });
    Object.defineProperty(up, 'pointerId', { value: 7 });
    panel.element.dispatchEvent(up);
    expect(commit).toHaveBeenCalledOnce();
    expect(grid.emitted('select-row')).toEqual([['key-0']]);
  });
  it.each([0, 1, 2])('reserves only the left button for row interactions (button %s)', (button) => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    const model = modelFixture();
    const mounted = mountCsvInputHost(
      CsvGridRow,
      {},
      {
        row: model.rowsByKey['key-0'],
        activity: { active: true, index: 0, hidden: false },
        columns: [{ column: model.columns[0]!, gridColumn: 2, offsetPx: 16 }],
        sourceIndex: model.sourceIndex,
        selected: false,
        isDirty: () => false,
      },
    );
    wrapper = mounted.host;
    const cellEvent = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
    mounted.surface.get('[data-column-key]').element.dispatchEvent(cellEvent);
    expect(cellEvent.defaultPrevented).toBe(button === 0);
    const handleEvent = new MouseEvent('pointerdown', { button, bubbles: true, cancelable: true });
    mounted.surface.get('.csv-row-handle').element.dispatchEvent(handleEvent);
    expect(handleEvent.defaultPrevented).toBe(button === 0);
    expect(mounted.surface.emitted('start-row-drag')?.length ?? 0).toBe(button === 0 ? 1 : 0);
    expect(mounted.surface.emitted('activate-cell')).toBeUndefined();
    expect(mounted.surface.emitted('select-row')).toBeUndefined();
  });

  it.each(['reference', 'multi', 'text'] as const)('commits and closes %s when clicking viewport blank space', async (control) => {
    const model = modelFixture();
    model.columns[0]!.schema = { key: 'id', control, source: 'csv:ships.id' };
    model.sourceIndex = createCsvSourceIndex(
      ['csv:ships.id'],
      new Map([['csv:ships.id', ['s0', 's1'].map((value) => ({ label: value, value }))]]),
    );
    const grid = mountGrid(model, true, true);
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get(control === 'text' ? '.csv-cell-frame' : '[data-csv-picker]').trigger(control === 'text' ? 'dblclick' : 'click');
    await flushPromises();
    const selector = control === 'text' ? '.csv-cell-text-editor' : '.csv-cell-picker';
    expect(grid.find(selector).exists()).toBe(true);
    await grid.get(control === 'text' ? 'textarea' : '.csv-cell-picker-search').trigger('mousedown');
    expect(fixture.activeCell.value).toMatchObject({ rowKey: 'key-0', column: 'id' });
    if (control === 'text') await grid.get('textarea').setValue('updated text');
    else if (control === 'multi') await grid.findAll('.csv-cell-picker-option')[1]!.trigger('click');
    else await grid.get('.csv-cell-picker-search').setValue('pending search');
    await grid.get('.table-panel').trigger('mousedown');
    await flushPromises();
    expect(grid.find(selector).exists()).toBe(false);
    expect(fixture.activeCell.value).toBeNull();
    expect(fixture.updates).toEqual(
      control === 'reference'
        ? []
        : [{ target: { ...fixture.target, rowKey: 'key-0', column: 'id' }, value: control === 'text' ? 'updated text' : 's0, s1' }],
    );
  });
  it('prepares media from data changes while row mounting keeps the same demand', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const model = modelFixture();
    const resource: ResourceRef = { source: 'mod', relPath: 'graphics/a.png', ownerKind: 'ship', ownerId: 'a', key: 'spriteName' };
    model.columns[0]!.schema = { key: 'id', control: 'reference', source: 'csv:ships.id' };
    model.rowKeys = Array.from({ length: 20 }, (_, index) => 'key-' + index);
    model.rowsByKey = Object.fromEntries(model.rowKeys.map((key) => [key, csvDraftRow({ id: 'a' }, key)]));
    model.sourceIndex = createCsvSourceIndex(
      ['csv:ships.id'],
      new Map([['csv:ships.id', [{ label: 'A', value: 'a', resourceRef: resource }]]]),
    );
    const grid = mountGrid(model, true);
    await flushPromises();
    const prepared = prepare.mock.calls.length;
    while (frames.length) {
      frames.shift()!(performance.now());
      await flushPromises();
    }
    expect(grid.findAll('.row-slot')).toHaveLength(20);
    expect(prepare).toHaveBeenCalledTimes(prepared);
    const rows = (fixture.props.value.model as CsvGridModel).rowsByKey;
    rows['key-0']!.data.id = 'b';
    await flushPromises();
    expect(prepare.mock.calls.at(-1)![1]).toHaveLength(9);
    (fixture.props.value.model as CsvGridModel).sourceIndex = createCsvSourceIndex(
      ['csv:ships.id'],
      new Map([['csv:ships.id', [{ label: 'B', value: 'b', resourceRef: resource }]]]),
    );
    await flushPromises();
    expect(prepare.mock.calls.at(-1)![1]).toHaveLength(1);
    delete rows['key-0'];
    await flushPromises();
    expect(prepare.mock.calls.at(-1)![1]).toHaveLength(0);
    rows['key-0'] = csvDraftRow({ id: 'b' }, 'key-0');
    await flushPromises();
    expect(prepare.mock.calls.at(-1)![1]).toHaveLength(1);
    useSettingsStore().setEditMode('plain');
    await flushPromises();
    expect(prepare.mock.calls.at(-1)!.slice(1)).toEqual([[], []]);
  });

  it('refreshes the requested window and releases observation', async () => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.find('.row-slot').trigger('dblclick');
    const requests = grid.emitted('request-window')!.length;
    resize();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await grid.vm.$nextTick();
    expect(grid.emitted('request-window')!.length).toBeGreaterThan(requests);
    expect(fixture.activeCell.value).toMatchObject({ rowKey: 'key-0', column: 'id' });
    wrapper!.unmount();
    wrapper = null;
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('requests path image references only for Smart mode and releases them when its column leaves view', async () => {
    const model = modelFixture();
    model.columns[0]!.key = 'sprite';
    model.columns[0]!.schema = { key: 'sprite', control: 'path-image' };
    model.rowsByKey['key-0']!.data.sprite = 'graphics/icons/sample.png';
    model.columns[0]!.widthPx = 400;
    const resource: ResourceRef = {
      source: 'mod',
      relPath: 'graphics/icons/sample.png',
      ownerKind: 'hullmods',
      ownerId: 'sample',
      key: 'sprite',
    };
    queryImages.mockResolvedValue({ 'key-0': resource });
    const grid = mountGrid(model, true, false, true);
    resize();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await flushPromises();
    expect(queryImages).toHaveBeenCalledExactlyOnceWith(
      fixture.target.sessionId,
      fixture.target.table,
      ['key-0'],
      [{ rowKey: 'key-0', isComment: false, data: { id: 's0', sprite: resource.relPath } }],
      expect.any(AbortSignal),
    );
    expect(prepare.mock.calls.at(-1)![1]).toEqual(expect.arrayContaining([expect.objectContaining({ resources: [resource] })]));
    await vi.waitFor(() => expect(grid.find('[data-column-key="sprite"]').exists()).toBe(true));
    expect(grid.get('.csv-cell-thumb').attributes('resource')).toBeDefined();
    await grid.get('[data-column-key="sprite"] .csv-cell-value').trigger('click');
    await grid.get('.csv-cell-selection-input').trigger('keydown', { key: 'F2' });
    await flushPromises();
    expect(grid.get('.csv-cell-editor .csv-cell-thumb').attributes('resource')).toEqual(
      grid.get('.csv-cell-frame > .csv-cell-thumb').attributes('resource'),
    );
    await grid.get('.csv-cell-picker-search').trigger('keydown', { key: 'Escape' });
    (fixture.props.value.model as CsvGridModel).rowsByKey['key-0']!.data.name = 'Changed';
    await flushPromises();
    expect(queryImages).toHaveBeenCalledOnce();
    (fixture.props.value.model as CsvGridModel).rowsByKey['key-0']!.data.sprite = 'graphics/icons/edited.png';
    queryImages.mockResolvedValue({ 'key-0': { ...resource, relPath: 'graphics/icons/edited.png' } });
    await flushPromises();
    expect(queryImages).toHaveBeenCalledTimes(2);
    expect(queryImages.mock.calls[1]![3]).toEqual([
      { rowKey: 'key-0', isComment: false, data: { id: 's0', sprite: 'graphics/icons/edited.png' } },
    ]);
    const panel = grid.get('.table-panel');
    panel.element.scrollLeft = 400;
    await panel.trigger('scroll');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await flushPromises();
    expect(prepare.mock.calls.at(-1)!.slice(1)).toEqual([[], []]);
    useSettingsStore().setEditMode('plain');
    await grid.vm.$nextTick();
    expect(queryImages).toHaveBeenCalledTimes(2);
    wrapper!.unmount();
    wrapper = null;
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
    await grid.find('.row-slot').trigger('dblclick');
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-0']);
    expect(grid.findComponent(CsvGridEditorHost).props('target')).toMatchObject({ column: 'id', rowKey: 'key-0' });
  });

  it('keeps the active cell when the same target model is replaced', async () => {
    const grid = mountGrid();
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.find('.row-slot').trigger('dblclick');
    expect(grid.findComponent(CsvGridEditorHost).props('target')).not.toBeNull();

    fixture.props.value = { ...fixture.props.value, model: reactive(modelFixture()) };
    await grid.vm.$nextTick();
    expect(grid.findComponent(CsvGridEditorHost).props('target')).toMatchObject({ rowKey: 'key-0', column: 'id' });
  });

  it('forwards selection from the body', async () => {
    const grid = mountGrid();
    const body = grid.findComponent(CsvGridBody);
    body.vm.$emit('select-row', 'key-1');
    await grid.vm.$nextTick();
    expect(grid.emitted('select-row')?.at(-1)).toEqual(['key-1']);
  });

  it('keeps the current target when input validation rejects activation', async () => {
    const grid = mountGrid();
    const focus = vi.fn();
    fixture.inputs.register({ key: 'pending', label: 'Pending input', dirty: ref(true), commit: () => 'Invalid', focus, cancel: vi.fn() });
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get('.row-slot').trigger('dblclick');
    await flushPromises();
    expect(focus).toHaveBeenCalledOnce();
    expect(fixture.activeCell.value).toBeNull();
    expect(grid.emitted('select-row')).toBeUndefined();
  });

  it('activates another field in the selected row without selecting that row again', async () => {
    const grid = mountGrid();
    fixture.props.value = { ...fixture.props.value, selectedRowKey: 'key-0' };
    await vi.waitFor(() => expect(grid.find('.row-slot').exists()).toBe(true));
    await grid.get('.row-slot').trigger('dblclick');
    expect(fixture.activeCell.value?.rowKey).toBe('key-0');
    expect(grid.emitted('select-row')).toBeUndefined();
  });
});
