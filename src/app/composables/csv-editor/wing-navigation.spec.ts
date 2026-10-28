import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  useProjectStore().registerProjectManifest(update.projection.manifest);
  tables.initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest: update.projection.manifest });
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
      actions = useCsvEditorActions(feedback);
      return () => null;
    },
  });
  const request = (destination: 'hull' | 'variant') =>
    detailActionsForRow({ ...target, starsectorRoot: null }, 'wings', tables.selectedRowRecord).find(
      (action) => action.type === 'wing-navigation' && action.destination === destination,
    )!;
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
    expect(kind === 'ship' ? own.tables.currentTab : own.workspace.jsonPage).toBe(
      kind === 'ship' ? 'ships' : kind === 'skin' ? 'skins' : 'variants',
    );
  });
  it.each(['ship', 'skin', 'variant'] as const)('explains a Core %s while retaining the wing page', async (kind) => {
    const own = harness();
    await flushPromises();
    mocks.resolve.mockResolvedValue({ kind, id: 'core_target', source: 'core' });
    own.actions.handleDetailAction(own.request(kind === 'variant' ? 'variant' : 'hull'));
    await flushPromises();
    expect(own.workspace.currentView).toBe('table');
    expect(own.tables.currentTab).toBe('wings');
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
    expect(own.tables.currentTab).toBe('wings');
  });
  it('reports a missing target once and keeps the source selection', async () => {
    const own = harness();
    await flushPromises();
    mocks.resolve.mockRejectedValueOnce(new Error('Reference missing'));
    own.actions.handleDetailAction(own.request('hull'));
    await flushPromises();
    expect(feedback.error).toHaveBeenCalledOnce();
    expect(own.tables.selectedRowKey).toBe('wing-row');
  });
});
