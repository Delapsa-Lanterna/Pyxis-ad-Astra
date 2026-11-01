import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, h, ref } from 'vue';
import { useCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import CsvTableEditor from './CsvTableEditor.vue';
import CsvGrid from './CsvGrid.vue';
import type { CsvTableViewModel } from '@/app/composables/csv-editor/use-csv-table-view-model';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn() }) }));

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function tableVmFixture(overrides: { tables?: Record<string, unknown>; loadExternalTableUpdate?: () => void } = {}): CsvTableViewModel {
  return {
    target: ref({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }),
    gridModel: ref({ columns: [], rows: [], totalWidthPx: 0, performanceSample: {}, sourceIndex: {} }),
    effectiveColumns: ref([]),
    effectiveTotalWidthPx: ref(0),
    reorderDisabledReason: ref(''),
    reorderContext: ref('fixture'),
    loadExternalTableUpdate: overrides.loadExternalTableUpdate ?? vi.fn(),
    tables: {
      hasCurrentTableExternalUpdate: false,
      filteredRowCount: 0,
      totalRowCount: 0,
      rows: [],
      visibleColumns: ['id'],
      editing: null,
      isDirty: () => false,
      selectedRowKey: null,
      selectRowByKey: vi.fn(),
      getTableInputs: () => createFieldInputs(),
      updateCellValue: vi.fn(),
      setActiveCell: vi.fn(),
      ...overrides.tables,
    },
  } as unknown as CsvTableViewModel;
}

function mountTable(vm: CsvTableViewModel) {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  wrapper = mount(CsvTableEditor, {
    props: { csvTable: vm },
    global: {
      stubs: {
        'n-button': { emits: ['click'], template: `<button @click="$emit('click', $event)"><slot /></button>` },
        CsvGrid: {
          props: ['model', 'selectedRowKey', 'editing', 'isDirty'],
          emits: ['request-window', 'resize-column', 'select-row', 'undo', 'redo'],
          setup() {
            const inputs = useCsvTableInputs();
            return () =>
              h(
                'div',
                { class: 'csv-grid-stub' },
                h('button', { class: 'copy-fixture', onClick: () => inputs.range!.copy(['source'], 3) }),
              );
          },
        },
      },
    },
  });
  return wrapper!;
}

describe('CsvTableEditor', () => {
  it.each(['undo', 'redo'] as const)('forwards %s to the CSV action owner', (command) => {
    const mounted = mountTable(tableVmFixture());
    mounted.findComponent(CsvGrid).vm.$emit(command);
    expect(mounted.emitted(command)).toHaveLength(1);
  });
  it('copies through its captured table target', async () => {
    const copyRows = vi.fn();
    const fixture = tableVmFixture({ tables: { copyRows } });
    const currentTarget = ref(fixture.target.value);
    const vm = { ...fixture, target: computed(() => currentTarget.value) };
    const target = vm.target.value;
    const mounted = mountTable(vm);
    currentTarget.value = { sessionId: 'other', modRoot: 'M:/other', table: 'weapons' };
    await mounted.get('.copy-fixture').trigger('click');
    expect(copyRows).toHaveBeenCalledExactlyOnceWith(target, ['source'], 3);
  });
  it('renders the grid without notices for a clean table with columns', () => {
    const mounted = mountTable(tableVmFixture());
    expect(mounted.find('.table-external-update-note').exists()).toBe(false);
    expect(mounted.find('.table-empty-note').exists()).toBe(false);
    expect(mounted.find('.csv-grid-stub').exists()).toBe(true);
  });

  it('offers the external version entry when the table changed outside', async () => {
    const loadExternalTableUpdate = vi.fn();
    const mounted = mountTable(tableVmFixture({ tables: { hasCurrentTableExternalUpdate: true }, loadExternalTableUpdate }));
    const note = mounted.get('.table-external-update-note');
    expect(note.text()).toContain('外部更新');
    await note.get('button').trigger('click');
    expect(loadExternalTableUpdate).toHaveBeenCalledTimes(1);
  });

  it('explains tables whose rows are hidden by filters', () => {
    const mounted = mountTable(tableVmFixture({ tables: { rows: [{}], totalRowCount: 1, filteredRowCount: 0, visibleColumns: ['id'] } }));
    expect(mounted.get('.table-empty-note').text()).toContain('被搜索隐藏');
  });

  it('explains tables without any displayable columns', () => {
    const mounted = mountTable(tableVmFixture({ tables: { filteredRowCount: 5, visibleColumns: [] } }));
    expect(mounted.get('.table-empty-note').text()).toContain('没有可显示列');
  });
});
