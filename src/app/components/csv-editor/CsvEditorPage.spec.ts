import type { CsvValidationRequest } from '@/shared/types';
import { csvEditorView } from '@/app/composables/csv-editor/tests/csv-editor-view';
import { csvTableIndex } from '@/test/fixtures/csv-row';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvEditorPage from './CsvEditorPage.vue';
import { NInput } from 'naive-ui/es/input';
import { NDropdown } from 'naive-ui/es/dropdown';
import { useWorkspaceCsvEditorHost } from '@/app/composables/use-workspace-csv-editor-host';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import type { CsvTableIndex } from '@/shared/types';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({ query: vi.fn(), error: vi.fn() }));
vi.mock('@/services/csv-table.service', () => ({
  queryTableIndex: mocks.query,
  queryCsvValidation: async (_session: string, request: CsvValidationRequest) => ({
    complete: false,
    entities: Object.fromEntries(request.entities.map(({ kind, id }) => [kind + ':' + id, {}])),
    sources: Object.fromEntries(request.sources.map((source) => [source, []])),
    files: {},
    classes: {},
    stationData: {},
  }),
  queryTableRows: vi.fn(),
  queryTableRowPreviewDataUrl: async () => '',
}));
vi.mock('@/services/source-catalog.service', () => ({ querySourceOptionCatalog: async () => [] }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/app/composables/use-workspace-shell-actions', () => ({ useWorkspaceShellActions: () => ({}) }));

let wrapper: VueWrapper;
const target = { sessionId: 'search-session', modRoot: 'M:/search', table: 'ships' as const };
function record(header = ['id', 'name', 'tags']): CsvTableIndex {
  return csvTableIndex([{ rowKey: 'row', isComment: false, data: { id: 'Alpha', name: '银河', tags: 'demo_bp' } }], {
    table: 'ships',
    header,
    totalRows: 1,
    baseVersions: [],
  });
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
  const update = sessionUpdateFixture(target.sessionId, target.modRoot);
  update.content.manifest.tableSummaries.ships.header = record().header;
  useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: 'Search', version: '', status: 'ready' });
  useProjectStore().registerProjectManifest(update.content.manifest);
  useCsvEditorStore().initializeModTables({ ...target, manifest: update.content.manifest });
  navigateToModTable(target.modRoot, target.table);
  mocks.query.mockResolvedValue(record());
});
afterEach(() => wrapper?.unmount());
async function mountWorkspace() {
  wrapper = mount(
    defineComponent({
      setup() {
        const host = useWorkspaceCsvEditorHost(() => null);
        return () =>
          host.target.value ? h(CsvEditorPage, { key: JSON.stringify(host.target.value), target: host.target.value, host }) : null;
      },
    }),
    {
      attachTo: document.body,
      global: { stubs: { ...editorUiStubs, 'n-input': NInput, CsvTableEditor: true, CsvRowDetails: true } },
    },
  );
  await flushPromises();
}
describe('table workspace search controls', () => {
  it('retains collapsed details during edits and opens them for a save rejection', async () => {
    await mountWorkspace();
    await wrapper.get('[aria-controls]').trigger('click');
    const problems = useCsvEditorStore().getTableProblems(target);
    problems.recordFailure(new Error('Save failure'));
    await flushPromises();
    expect(wrapper.get('[aria-controls]').attributes('aria-expanded')).toBe('false');
    problems.reveal();
    await flushPromises();
    expect(wrapper.get('[aria-controls]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[role="alert"]').text()).toContain('Save failure');
  });
  it('toggles the detail pane without replacing the table, selection or mounted detail pane', async () => {
    await mountWorkspace();
    const table = wrapper.getComponent({ name: 'CsvTableEditor' }).element;
    const pane = wrapper.getComponent({ name: 'CsvRowDetails' }).element;
    const tables = useCsvEditorStore();
    tables.selectRowByKey(target, 'row');
    await wrapper.get('[aria-controls="csv-detail-panel"]').trigger('click');
    expect(wrapper.get('[aria-controls]').attributes('aria-expanded')).toBe('false');
    expect(wrapper.getComponent({ name: 'CsvRowDetails' }).isVisible()).toBe(false);
    expect(wrapper.getComponent({ name: 'CsvTableEditor' }).element).toBe(table);
    expect(csvEditorView(target).selectedRowKey).toBe('row');
    await wrapper.get('[aria-controls]').trigger('click');
    expect(wrapper.get('[aria-controls]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.getComponent({ name: 'CsvRowDetails' }).element).toBe(pane);
    expect(wrapper.getComponent({ name: 'CsvRowDetails' }).isVisible()).toBe(true);
  });

  it('retains the window-owned detail pane choice when the table page is reopened', async () => {
    const expanded = ref(true),
      shown = ref(true);
    wrapper = mount(
      defineComponent({
        setup() {
          const host = useWorkspaceCsvEditorHost(() => null);
          return () =>
            shown.value && host.target.value
              ? h(CsvEditorPage, {
                  target: host.target.value,
                  host,
                  key: JSON.stringify(host.target.value),
                  detailPaneExpanded: expanded.value,
                  'onUpdate:detailPaneExpanded': (value: boolean) => {
                    expanded.value = value;
                  },
                })
              : null;
        },
      }),
      { global: { stubs: { ...editorUiStubs, CsvTableEditor: true, CsvRowDetails: true } } },
    );
    await flushPromises();
    await wrapper.get('[aria-controls]').trigger('click');
    expect(expanded.value).toBe(false);
    shown.value = false;
    await flushPromises();
    shown.value = true;
    await flushPromises();
    expect(wrapper.get('[aria-controls]').attributes('aria-expanded')).toBe('false');
    await wrapper.get('[aria-controls]').trigger('click');
    expect(expanded.value).toBe(true);
  });

  it('shows the declared fields and changes the search prompt while retaining the keyword', async () => {
    await mountWorkspace();
    const menu = wrapper.getComponent(NDropdown);
    expect(menu.props('options')!.map((option) => option.label)).toEqual(['ID/名称', 'ID', '名称', 'tags']);
    expect(menu.props('value')).toBe('id-name');
    await wrapper.get('input').setValue('Alpha');
    await flushPromises();
    for (const [field, label] of [
      ['id', 'ID'],
      ['name', '名称'],
      ['tags', 'tags'],
    ] as const) {
      menu.vm.$emit('select', field);
      await flushPromises();
      expect(csvEditorView(target).searchField).toBe(field);
      expect(csvEditorView(target).searchText).toBe('Alpha');
      expect(wrapper.getComponent(NInput).props('placeholder')).toBe(`搜索 ${label}`);
      expect(mocks.query).toHaveBeenLastCalledWith(target.sessionId, 'ships', 0, 'Alpha', field, expect.any(AbortSignal));
    }
  });
  it('offers options from the authoritative header as it loads', async () => {
    const tables = useCsvEditorStore();
    tables.getCsvModState(target.modRoot)!.documents.ships.header = [];
    mocks.query.mockResolvedValue(record(['id']));
    await mountWorkspace();
    expect(
      wrapper
        .getComponent(NDropdown)
        .props('options')!
        .map((option) => option.label),
    ).toEqual(['ID/名称', 'ID']);
    expect(csvEditorView(target).currentHeader).toEqual(['id']);
  });
  it('binds input and search-field locking to the current editing target', async () => {
    await mountWorkspace();
    useCsvEditorStore().lockTable(target, 'identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(true);
    expect(wrapper.get('[aria-label="选择搜索项"]').attributes('disabled')).toBeDefined();
    expect(
      wrapper
        .getComponent(NDropdown)
        .props('options')!
        .every((option) => option.disabled),
    ).toBe(true);
    useCsvEditorStore().releaseTableLock('identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(false);
    expect(wrapper.get('[aria-label="选择搜索项"]').attributes('disabled')).toBeUndefined();
  });
  it('opens a checked menu, clears the keyword and releases the old menu when switching tables', async () => {
    await mountWorkspace();
    await wrapper.get('input').setValue('Alpha');
    await flushPromises();
    await wrapper.get('[aria-label="选择搜索项"]').trigger('click');
    await flushPromises();
    expect(document.querySelectorAll('.n-dropdown-menu .ui-control-icon')).toHaveLength(1);
    await wrapper.get('input').trigger('focus');
    await wrapper.get('.n-base-clear__clear').trigger('click');
    await flushPromises();
    expect(csvEditorView(target).searchText).toBe('');
    expect(csvEditorView(target).searchField).toBe('id-name');
    await wrapper.get('[aria-label="选择搜索项"]').trigger('click');
    await flushPromises();
    navigateToModTable(target.modRoot, 'weapons');
    await flushPromises();
    expect(document.querySelector('.n-dropdown-menu')).toBeNull();
  });
  it('keeps the keyword and focus when clearing cannot submit a table input', async () => {
    await mountWorkspace();
    await wrapper.get('input').setValue('Alpha');
    await flushPromises();
    const focus = vi.fn();
    useCsvEditorStore()
      .getTableInputs(target.modRoot, target.table)
      .register({ key: 'row/name', label: 'Name', dirty: ref(true), focus, cancel: vi.fn(), commit: () => 'Invalid' });
    await wrapper.get('input').trigger('focus');
    await wrapper.get('.n-base-clear__clear').trigger('click');
    await flushPromises();
    expect(csvEditorView(target).searchText).toBe('Alpha');
    expect(focus).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
