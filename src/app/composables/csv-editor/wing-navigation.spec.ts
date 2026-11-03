import { useWorkspaceCsvEditorHost } from '@/app/composables/use-workspace-csv-editor-host';
import { useCsvEditorModel } from './use-csv-editor-model';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { csvEditorView } from '@/app/composables/csv-editor/tests/csv-editor-view';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi, onTestFinished } from 'vitest';
import { useCsvEditorActions } from './use-csv-editor-actions';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvTableIndex } from '@/test/fixtures/csv-row';
import type { AppFeedback } from '@/shared/types';
import { detailActionsForRow } from '@/domain/csv-editor/table-detail-actions';
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('@/orchestrators/joint-edit.orchestrator', () => ({ resolveWingReference: mocks.resolve }));
vi.mock('@/orchestrators/immersive-editor.orchestrator', () => ({ openEntityImmersiveEditor: vi.fn() }));
let wrapper: VueWrapper;
const feedback = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  choose: vi.fn(),
  confirmDanger: vi.fn(),
  confirmWarning: vi.fn(),
} satisfies AppFeedback;
function harness() {
  const update = sessionUpdateFixture('s', 'M:/mod');
  const workspace = useWorkspaceStore(),
    tables = useCsvEditorStore();
  workspace.registerMod({ modRoot: 'M:/mod', displayName: 'Sample', version: '', status: 'ready' });
  useProjectStore().registerProjectManifest(update.content.manifest);
  tables.initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest: update.content.manifest });
  tables.switchTab('M:/mod', 'wings');
  workspace.activateModTable('M:/mod');
  const target = { sessionId: 's', modRoot: 'M:/mod', table: 'wings' as const };
  tables.applyTableIndex(
    target,
    csvTableIndex([{ rowKey: 'wing-row', isComment: false, data: { id: 'sample_wing', variant: 'sample_variant' } }], { table: 'wings' }),
  );
  tables.selectRowByKey(target, 'wing-row');
  let actions!: ReturnType<typeof useCsvEditorActions>;
  wrapper = mount({
    setup() {
      const host = useWorkspaceCsvEditorHost(() => null);
      actions = useCsvEditorActions(useCsvEditorModel(host.target), host, feedback);
      return () => null;
    },
  });
  const request = (destination: 'hull' | 'variant') =>
    detailActionsForRow(
      { ...target, starsectorRoot: null },
      'wings',
      csvEditorView({ sessionId: 's', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab })
        .selectedRowRecord,
    ).find((action) => action.type === 'wing-navigation' && action.destination === destination)!;
  return { actions, workspace, tables, request, target };
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
});
afterEach(() => wrapper?.unmount());
describe('wing reference navigation', () => {
  it.each(['ship', 'skin', 'variant'] as const)('locates a Mod %s through the formal target', async (kind) => {
    const own = harness();
    await flushPromises();
    mocks.resolve.mockResolvedValue({ kind, id: 'target_id', source: 'mod', rowKey: kind === 'ship' ? 'ship-row' : undefined });
    own.actions.handleDetailAction(own.request(kind === 'variant' ? 'variant' : 'hull'));
    await flushPromises();
    expect(own.workspace.entityLocation).toMatchObject({ sessionId: 's', modRoot: 'M:/mod', kind, id: 'target_id' });
    expect(own.workspace.currentView).toBe(kind === 'ship' ? 'table' : 'json-editor');
    expect(
      kind === 'ship'
        ? csvEditorView({ sessionId: 's', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab }).currentTab
        : own.workspace.jsonPage,
    ).toBe(kind === 'ship' ? 'ships' : kind === 'skin' ? 'skins' : 'variants');
  });
  it.each(['ship', 'skin', 'variant'] as const)('explains a Core %s while retaining the wing page', async (kind) => {
    const own = harness();
    await flushPromises();
    mocks.resolve.mockResolvedValue({ kind, id: 'core_target', source: 'core' });
    own.actions.handleDetailAction(own.request(kind === 'variant' ? 'variant' : 'hull'));
    await flushPromises();
    expect(own.workspace.currentView).toBe('table');
    expect(
      csvEditorView({ sessionId: 's', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab }).currentTab,
    ).toBe('wings');
    expect(own.workspace.entityLocation).toBeNull();
    expect(feedback.info).toHaveBeenCalledOnce();
    expect(feedback.info.mock.calls[0]![0]).toContain('core_target');
  });
  it.each(['selection', 'newer', 'input'] as const)('rejects a late reference after %s changes', async (reason) => {
    const own = harness();
    await flushPromises();
    let finish!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    own.actions.handleDetailAction(own.request('hull'));
    await flushPromises();
    if (reason === 'selection') own.tables.selectRowByKey(own.target, null);
    else if (reason === 'input') own.tables.updateCellValue({ ...own.target, rowKey: 'wing-row', column: 'variant' }, 'later_variant');
    else {
      mocks.resolve.mockResolvedValueOnce({ kind: 'variant', id: 'newer', source: 'core' });
      own.actions.handleDetailAction(own.request('variant'));
    }
    finish({ kind: 'ship', id: 'stale', source: 'mod', rowKey: 'stale-row' });
    await flushPromises();
    expect(own.workspace.entityLocation).toBeNull();
    expect(
      csvEditorView({ sessionId: 's', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab }).currentTab,
    ).toBe('wings');
  });
  it('reports a missing target once and keeps the source selection', async () => {
    const own = harness();
    await flushPromises();
    mocks.resolve.mockRejectedValueOnce(new Error('Reference missing'));
    own.actions.handleDetailAction(own.request('hull'));
    await flushPromises();
    expect(feedback.error).toHaveBeenCalledOnce();
    expect(
      csvEditorView({ sessionId: 's', modRoot: 'M:/mod', table: useCsvEditorStore().getCsvModState('M:/mod')!.currentTab }).selectedRowKey,
    ).toBe('wing-row');
  });
});

describe('wing navigation view lifetime', () => {
  it.each(['save', 'input', 'query', 'selection-return'] as const)(
    'ends an earlier %s continuation after its view context changes',
    async (stage) => {
      const own = harness();
      await flushPromises();
      let finish!: () => void;
      const pending = new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      });
      onTestFinished(async () => {
        finish();
        await pending;
      });
      if (stage === 'save' || stage === 'selection-return') vi.spyOn(useSaveCommandStore(), 'waitForSaves').mockReturnValueOnce(pending);
      else if (stage === 'input') vi.spyOn(own.tables.getTableInputs(own.target.modRoot, 'wings'), 'commit').mockReturnValueOnce(pending);
      else
        mocks.resolve.mockImplementationOnce(async () => {
          await pending;
          return { kind: 'ship', id: 'late', source: 'mod', rowKey: 'late-row' };
        });
      own.actions.handleDetailAction(own.request('hull'));
      await flushPromises();
      if (stage === 'selection-return') {
        own.tables.selectRowByKey(own.target, null);
        own.tables.selectRowByKey(own.target, 'wing-row');
      } else own.workspace.showAbout();
      await flushPromises();
      finish();
      await flushPromises();
      expect(own.workspace.currentView).toBe(stage === 'selection-return' ? 'table' : 'about');
      expect(own.workspace.entityLocation).toBeNull();
      expect(mocks.resolve).toHaveBeenCalledTimes(stage === 'query' ? 1 : 0);
      expect(feedback.error).not.toHaveBeenCalled();
    },
  );
  it('ends a save wait when its action scope releases', async () => {
    const own = harness();
    await flushPromises();
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    onTestFinished(async () => {
      finish(true);
      await pending;
    });
    vi.spyOn(useSaveCommandStore(), 'waitForSaves').mockReturnValueOnce(pending);
    own.actions.handleDetailAction(own.request('hull'));
    await flushPromises();
    wrapper.unmount();
    finish(true);
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(own.workspace.entityLocation).toBeNull();
  });
});
