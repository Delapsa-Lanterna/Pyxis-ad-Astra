import { EDIT_MODES } from '@/shared/types';
import { computed } from 'vue';
import { useCsvEditorModel } from '@/app/composables/csv-editor/use-csv-editor-model';
import { csvTableIndex } from '@/test/fixtures/csv-row';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { TABLE_KEYS } from '@/shared/types';
import type { CsvTableIndex, ProjectManifest } from '@/shared/types';
import CsvRowDetails from './CsvRowDetails.vue';
import { createCsvSourceIndex } from '@/domain/field-editor/csv-source-options';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import * as columns from '@/domain/csv-editor/csv-column-schema';

function tableSummariesFixture(): ProjectManifest['tableSummaries'] {
  const summaries = {} as ProjectManifest['tableSummaries'];
  for (const key of TABLE_KEYS) {
    summaries[key] = { path: '', header: [], available: false, totalRows: 0 };
  }
  return summaries;
}

function tableEntitySummariesFixture(): ProjectManifest['tableEntitySummaries'] {
  const summaries = {} as ProjectManifest['tableEntitySummaries'];
  for (const key of TABLE_KEYS) summaries[key] = 0;
  return summaries;
}

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  }),
}));

const media = vi.hoisted(() => ({ replace: vi.fn(async () => {}), preview: vi.fn(async () => '') }));
vi.mock('@/app/composables/field-editor/use-field-option-media', () => ({
  useFieldOptionMedia: () => ({
    dataUrl: vi.fn(() => 'data:image/png;base64,thumb'),
    replaceCollection: media.replace,
    releaseCollection: vi.fn(),
  }),
}));

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  media.replace.mockClear();
  media.preview.mockClear();
});

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 'sess-1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: ['ships'],
    modInfo: { name: 'Alpha' },
    tableSummaries: tableSummariesFixture(),
    tableEntitySummaries: tableEntitySummariesFixture(),
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

function activateProject() {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const tables = useCsvEditorStore();
  workspace.registerMod({ modRoot: 'M:/mod', displayName: 'Alpha', version: '', status: 'ready' });
  project.registerProjectManifest(manifestFixture('M:/mod'));
  // Hydrate the per-Mod table state the same way the directory-opening runtime does.
  tables.initializeModTables({ sessionId: manifestFixture('M:/mod').sessionId, modRoot: 'M:/mod', manifest: manifestFixture('M:/mod') });
  workspace.activateModTab('M:/mod');
  return { workspace, project, tables };
}

function mountPane() {
  wrapper = mount(CsvRowDetails, {
    props: {
      model: useCsvEditorModel(
        computed(() => ({ sessionId: 'sess-1', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab })),
      ),
      starsectorRoot: null,
      queryRowPreview: media.preview,
      sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
    },
    global: { plugins: [getActivePinia()!], stubs: editorUiStubs },
  });
  return wrapper!;
}

describe('CsvRowDetails', () => {
  it.each(EDIT_MODES)('shares schema selection with media and descriptions in %s mode', async (mode) => {
    const { tables } = activateProject();
    useSettingsStore().setEditMode(mode);
    const target = { sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' as const };
    const keys = Array.from({ length: 10 }, (_, index) => 'field-' + index);
    vi.spyOn(columns, 'csvColumnSchemasForTable').mockImplementation((table) =>
      table === 'ships'
        ? [
            ...keys.map((key, index) => ({
              key,
              label: key,
              control: 'reference' as const,
              source: 'csv:ships.id',
              summary: true,
              description: index === 0 ? 'First line\nSecond line' : '',
            })),
            { key: 'disabled', control: 'text', summary: false },
            { key: 'ordinary', control: 'text' },
            { key: 'absent', control: 'text', summary: true },
          ]
        : [],
    );
    const rows = ['first', 'second'].map((value) => ({
      rowKey: value,
      isComment: false,
      data: Object.fromEntries([...keys, 'disabled', 'ordinary', 'extra'].map((key) => [key, value])),
    }));
    const index = csvTableIndex(rows, { table: 'ships', header: ['extra', 'ordinary', 'disabled', ...keys.toReversed()], totalRows: 2 });
    tables.applyTableIndex(target, index);
    tables.selectRowByKey(target, 'first');
    const pane = mountPane();
    const resource = (id: string) => ({
      source: 'mod' as const,
      relPath: 'graphics/' + id + '.png',
      ownerKind: 'ship' as const,
      ownerId: id,
      key: 'sprite',
    });
    await pane.setProps({
      sourceIndex: createCsvSourceIndex(
        ['csv:ships.id'],
        new Map([['csv:ships.id', ['first', 'second'].map((value) => ({ value, label: value, resourceRef: resource(value) }))]]),
      ),
    });
    expect(pane.findAll('.schema-preview-label').map((label) => label.text())).toEqual(keys);
    expect(pane.findAll('.schema-preview-label')[0]!.attributes('title')).toBe('field-0\nFirst line\nSecond line');
    expect(pane.findAll('.schema-preview-label')[1]!.attributes('title')).toBe('field-1');
    expect(media.replace).toHaveBeenLastCalledWith('sess-1', 'summary', mode === 'smart' ? keys.map(() => resource('first')) : []);
    tables.selectRowByKey(target, 'second');
    await pane.vm.$nextTick();
    expect(pane.findAll('.schema-preview-value-value').map((value) => value.text())).toEqual(keys.map(() => 'second'));
    expect(media.replace).toHaveBeenLastCalledWith('sess-1', 'summary', mode === 'smart' ? keys.map(() => resource('second')) : []);
    expect(media.preview).toHaveBeenCalledTimes(2);
    tables.applyTableIndex(target, { ...index, header: ['disabled', 'ordinary', 'extra'] });
    await pane.vm.$nextTick();
    expect(pane.findAll('.panel-section-title').map((title) => title.text())).toEqual(['详情栏', '操作']);
    expect(media.replace).toHaveBeenLastCalledWith('sess-1', 'summary', []);
    tables.switchTab(target.modRoot, 'wings');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-empty-value').text()).toBe('未选择记录');
  });
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
  });

  it('renders the display id and module label of the selected row', async () => {
    activateProject();
    const tables = useCsvEditorStore();
    const manifest = useProjectStore().getManifest('M:/mod')!;
    // Seed one ship row through the table state store.
    const window = csvTableIndex([{ rowKey: 'key-XY', isComment: false, data: { id: 'XY', name: 'Ruler' } }], {
      baseVersions: [],
      table: 'ships',
      header: ['id', 'name'],
      totalRows: 1,
    }) satisfies CsvTableIndex;
    tables.applyTableIndex({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-XY');
    void manifest;

    const pane = mountPane();
    expect(pane.html()).toContain('XY');
  });

  it('handles an empty selection without crashing', () => {
    activateProject();
    const pane = mountPane();
    expect(pane.exists()).toBe(true);
  });

  it.each(EDIT_MODES)('tracks wing names through source loading, selection and reference edits in %s mode', async (mode) => {
    const { tables } = activateProject();
    useSettingsStore().setEditMode(mode);
    const target = { sessionId: 'sess-1', modRoot: 'M:/mod', table: 'wings' as const };
    tables.switchTab(target.modRoot, target.table);
    tables.applyTableIndex(
      target,
      csvTableIndex(
        [
          { rowKey: 'wing-a', isComment: false, data: { id: 'wing-a', variant: 'fighter-a' } },
          { rowKey: 'wing-b', isComment: false, data: { id: 'wing-b', variant: 'fighter-b' } },
        ],
        { baseVersions: [], table: 'wings', header: ['id', 'variant'], totalRows: 2 },
      ),
    );
    tables.selectRowByKey(target, 'wing-a');
    const pane = mountPane();
    expect(pane.get('.detail-name').text()).toBe('fighter-a');
    const sources = (label: string) =>
      createCsvSourceIndex(
        ['csv:variants.variantId'],
        new Map([
          [
            'csv:variants.variantId',
            [
              {
                type: 'group',
                value: 'mod',
                label: '当前 Mod',
                children: [
                  { value: 'fighter-a', label },
                  { value: 'fighter-b', label: '轰炸机 (fighter-b)' },
                ],
              },
            ],
          ],
        ]),
      );
    await pane.setProps({ sourceIndex: sources('截击机 (fighter-a)') });
    expect(pane.get('.detail-name').text()).toBe('截击机 (fighter-a)');
    tables.selectRowByKey(target, 'wing-b');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-id').text()).toBe('wing-b');
    expect(pane.get('.detail-name').text()).toBe('轰炸机 (fighter-b)');
    tables.updateCellValue({ ...target, rowKey: 'wing-b', column: 'variant' }, 'fighter-a');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-name').text()).toBe('截击机 (fighter-a)');
    await pane.setProps({ sourceIndex: sources('战斗机 (fighter-a)') });
    expect(pane.get('.detail-name').text()).toBe('战斗机 (fighter-a)');
    tables.updateCellValue({ ...target, rowKey: 'wing-b', column: 'variant' }, 'unresolved');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-name').text()).toBe('unresolved');
    tables.updateCellValue({ ...target, rowKey: 'wing-b', column: 'variant' }, '');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-name').text()).toBe('未指定装配');
    tables.switchTab(target.modRoot, 'ships');
    await pane.vm.$nextTick();
    expect(pane.get('.detail-empty-value').text()).toBe('未选择记录');
  });

  it('shows the referenced variant name for simulated opponents', async () => {
    const { tables } = activateProject();
    const target = { sessionId: 'sess-1', modRoot: 'M:/mod', table: 'simOpponents' as const };
    tables.switchTab(target.modRoot, target.table);
    tables.applyTableIndex(
      target,
      csvTableIndex([{ rowKey: 'opponent-a', isComment: false, data: { 'variant id': 'variant-a' } }], {
        baseVersions: [],
        table: 'simOpponents',
        header: ['variant id'],
        totalRows: 1,
      }),
    );
    tables.selectRowByKey(target, 'opponent-a');
    const pane = mountPane();
    await pane.setProps({
      sourceIndex: createCsvSourceIndex(
        ['csv:variants.variantId'],
        new Map([
          [
            'csv:variants.variantId',
            [
              {
                type: 'group',
                value: 'mod',
                label: '当前 Mod',
                children: [{ value: 'variant-a', label: 'Thunderclap (Assault)' }],
              },
            ],
          ],
        ]),
      ),
    });
    expect(pane.get('.detail-name').text()).toBe('Thunderclap (Assault)');
  });

  it('exposes the editor actions for a registered spec table', async () => {
    activateProject();
    const tables = useCsvEditorStore();
    const window = csvTableIndex([{ rowKey: 'key-XY', isComment: false, data: { id: 'XY', name: '#quoted' } }], {
      baseVersions: [],
      table: 'ships',
      header: ['id'],
      totalRows: 1,
    }) satisfies CsvTableIndex;
    tables.applyTableIndex({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-XY');

    const pane = mountPane();
    const html = pane.html();
    // The ships table carries a ship spec editor entry point.
    expect(html).toContain('舰船编辑器');
  });

  it('marks comment rows in the detail header', async () => {
    activateProject();
    const tables = useCsvEditorStore();
    const window = csvTableIndex([{ rowKey: 'key-c', isComment: true, data: { id: '#note' } }], {
      baseVersions: [],
      table: 'ships',
      header: ['id'],
      totalRows: 1,
    }) satisfies CsvTableIndex;
    tables.applyTableIndex({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-c');

    const pane = mountPane();
    expect(pane.html()).toContain('#note');
    expect(pane.html()).toContain('注释行只允许编辑 CSV 内容');
    expect(pane.html()).not.toContain('舰船编辑器');
  });
});
