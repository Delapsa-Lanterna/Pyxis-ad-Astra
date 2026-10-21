import { csvTableIndex } from '@/test/csv-row';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvEditorWorkspace from './CsvEditorWorkspace.vue';
import { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
import type { AppFeedback } from '@/shared/types';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { sessionUpdateFixture } from '@/test/write-result';
import { editorUiStubs, nInput } from '@/test/ui-stubs';
import type { CsvTableIndex } from '@/shared/types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), error: vi.fn() }));
vi.mock('@/services/csv-table.service', () => ({
  queryTableIndex: mocks.query,
  queryTableRows: vi.fn(),
  queryTableRowPreviewDataUrl: async () => '',
}));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: async () => [] }));
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
  if (update.status !== 'ready') throw new Error('fixture is ready');
  update.projection.manifest.tableSummaries.ships.header = record().header;
  useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: 'Search', version: '', status: 'ready' });
  useProjectStore().registerProjectManifest(update.projection.manifest);
  useCsvEditorStore().initializeModTables({ ...target, manifest: update.projection.manifest });
  navigateToModTable(target.modRoot, target.table);
  mocks.query.mockResolvedValue(record());
});
afterEach(() => wrapper?.unmount());
async function mountWorkspace() {
  wrapper = mount(CsvEditorWorkspace, {
    props: { actions: useCsvEditorActions({ error: mocks.error } as unknown as AppFeedback) },
    attachTo: document.body,
    global: { stubs: { ...editorUiStubs, CsvTableEditor: true, CsvRowDetails: true } },
  });
  await flushPromises();
}
describe('table workspace search controls', () => {
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
    expect(tables.selectedRowKey).toBe('row');
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
        setup: () => () =>
          shown.value
            ? h(CsvEditorWorkspace, {
                actions: useCsvEditorActions({ error: mocks.error } as unknown as AppFeedback),
                detailPaneExpanded: expanded.value,
                'onUpdate:detailPaneExpanded': (value: boolean) => {
                  expanded.value = value;
                },
              })
            : null,
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
    const select = wrapper.get('select');
    expect(select.findAll('option').map((option) => option.text())).toEqual(['ID/名称', 'ID', '名称', 'tags']);
    expect((select.element as HTMLSelectElement).value).toBe('"id-name"');
    await wrapper.get('input').setValue('Alpha');
    await flushPromises();
    for (const [field, label] of [
      ['id', 'ID'],
      ['name', '名称'],
      ['tags', 'tags'],
    ] as const) {
      await select.setValue(JSON.stringify(field));
      await flushPromises();
      expect(useCsvEditorStore().searchField).toBe(field);
      expect(useCsvEditorStore().searchText).toBe('Alpha');
      expect(wrapper.getComponent(nInput).props('placeholder')).toBe(`搜索 ${label}`);
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
        .get('select')
        .findAll('option')
        .map((option) => option.text()),
    ).toEqual(['ID/名称', 'ID']);
    expect(tables.currentHeader).toEqual(['id']);
  });
  it('binds input and search-field locking to the current editing target', async () => {
    await mountWorkspace();
    useCsvEditorStore().lockTable(target, 'identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.get('select').element as HTMLSelectElement).disabled).toBe(true);
    useCsvEditorStore().releaseTableLock('identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(false);
    expect((wrapper.get('select').element as HTMLSelectElement).disabled).toBe(false);
  });
});
