import { ref } from 'vue';
import { enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { useCsvEditorActions } from './use-csv-editor-actions';
import { useCsvEditorModel } from './use-csv-editor-model';
import { useWorkspaceCsvEditorHost } from '@/app/composables/use-workspace-csv-editor-host';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { mountSetup } from '@/test/unit/mount-setup';

enableAutoUnmount(afterEach);
const mocks = vi.hoisted(() => ({
  tables: { activeEditor: { save: vi.fn(), undo: vi.fn(), redo: vi.fn() } },
}));

function feedbackStub(): AppFeedback {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  };
}

describe('CSV editor actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    vi.clearAllMocks();
    const manifest = sessionUpdateFixture('s', 'M:/mod').projection.manifest;
    useWorkspaceStore().registerMod({ modRoot: manifest.modRoot, displayName: 'Fixture', version: '', status: 'ready' });
    useProjectStore().registerProjectManifest(manifest);
    useCsvEditorStore().initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
    const editor = useCsvEditorStore().bindSaveActions(
      { sessionId: 's', modRoot: 'M:/mod', table: 'ships' },
      { save: mocks.tables.activeEditor.save, waitForSave: async () => true, saving: ref(false) },
    );
    vi.spyOn(editor, 'undo').mockImplementation(mocks.tables.activeEditor.undo);
    vi.spyOn(editor, 'redo').mockImplementation(mocks.tables.activeEditor.redo);
    useWorkspaceStore().activateModTable('M:/mod');
    mocks.tables.activeEditor.undo.mockResolvedValue(true);
    mocks.tables.activeEditor.redo.mockResolvedValue(true);
  });
  it('returns the active document save result', async () => {
    const result = { status: 'saved', receipt: savedWriteFixture() };
    mocks.tables.activeEditor.save.mockResolvedValue(result);
    const { value: actions } = mountSetup(() => {
      const host = useWorkspaceCsvEditorHost(() => null);
      return useCsvEditorActions(useCsvEditorModel(host.target), host, feedbackStub());
    });
    expect(await actions.save()).toEqual(result);
    expect(mocks.tables.activeEditor.save).toHaveBeenCalledOnce();
  });
  it('informs when there is nothing to save', async () => {
    mocks.tables.activeEditor.save.mockResolvedValue({ status: 'noop' });
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => {
      const host = useWorkspaceCsvEditorHost(() => null);
      return useCsvEditorActions(useCsvEditorModel(host.target), host, feedback);
    });
    await actions.save();
    expect(feedback.info).toHaveBeenCalledWith('没有需要保存的修改');
  });
  it.each(['undo', 'redo'] as const)('delegates %s to the current document actions and reports rejection', async (direction) => {
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => {
      const host = useWorkspaceCsvEditorHost(() => null);
      return useCsvEditorActions(useCsvEditorModel(host.target), host, feedback);
    });
    const action = direction === 'undo' ? actions.undoCurrentTableEdit : actions.redoCurrentTableEdit;
    await action();
    expect(mocks.tables.activeEditor[direction]).toHaveBeenCalledOnce();
    expect(feedback.error).not.toHaveBeenCalled();
    mocks.tables.activeEditor[direction].mockResolvedValueOnce(false);
    await action();
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith(direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
  });
});
