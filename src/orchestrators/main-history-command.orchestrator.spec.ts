import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceView } from '@/shared/types';
import type { AppFeedback } from '@/shared/types';
function feedbackFixture(): AppFeedback {
  return {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    choose: vi.fn(async () => null),
    confirmWarning: vi.fn(),
    confirmDanger: vi.fn(),
  };
}

const mocks = vi.hoisted(() => ({
  fileUndo: vi.fn(),
  fileRedo: vi.fn(),
  csv: { undo: vi.fn(), redo: vi.fn() },
  json: { undo: vi.fn(), redo: vi.fn() },
  workspace: { activeModRoot: 'M:/alpha', activeSessionId: 's1', currentView: 'table' as WorkspaceView, jsonPage: 'mod-info' },
  tables: { currentTab: 'ships', currentTableLocked: false, activeEditor: null as unknown },
}));
vi.mock('@/orchestrators/file-history-replay.orchestrator', () => ({
  replayNextFileUndo: mocks.fileUndo,
  replayNextFileRedo: mocks.fileRedo,
}));
vi.mock('@/stores/csv-editor.store', () => ({ useCsvEditorStore: () => mocks.tables }));
vi.mock('@/stores/project.store', () => ({ useProjectStore: () => ({}) }));
vi.mock('@/stores/workspace.store', () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock('@/stores/json-editor.store', () => ({ useJsonEditorStore: () => ({ active: mocks.json }) }));
import { dispatchMainRedoCommand, dispatchMainUndoCommand } from './main-history-command.orchestrator';

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.workspace, { activeModRoot: 'M:/alpha', activeSessionId: 's1', currentView: 'table', jsonPage: 'mod-info' });
  Object.assign(mocks.tables, { currentTab: 'ships', currentTableLocked: false, activeEditor: mocks.csv });
});
describe.each([
  ['undo', dispatchMainUndoCommand],
  ['redo', dispatchMainRedoCommand],
] as const)('main %s', (direction, dispatch) => {
  it.each(['table', 'json-editor'] as const)('dispatches only the visible %s document', async (view) => {
    mocks.workspace.currentView = view;
    const selected = view === 'table' ? mocks.csv : mocks.json;
    selected[direction].mockResolvedValue(true);
    const feedback = feedbackFixture();
    await dispatch(feedback);
    expect(selected[direction]).toHaveBeenCalledOnce();
    expect((view === 'table' ? mocks.json : mocks.csv)[direction]).not.toHaveBeenCalled();
    expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).not.toHaveBeenCalled();
  });
  it.each([true, false, null] as const)('consumes the document outcome %s', async (result) => {
    mocks.csv[direction].mockResolvedValue(result);
    const feedback = feedbackFixture();
    await dispatch(feedback);
    expect(feedback.error).toHaveBeenCalledTimes(result === false ? 1 : 0);
    expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).toHaveBeenCalledTimes(result === null ? 1 : 0);
  });
  it('reports invalid input without consuming file history', async () => {
    const error = new Error('Invalid field');
    mocks.csv[direction].mockRejectedValue(error);
    const feedback = feedbackFixture();
    await dispatch(feedback);
    expect(feedback.error).toHaveBeenCalledWith(error, expect.any(String));
    expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).not.toHaveBeenCalled();
  });
  it.each(['mod-overview', 'file-history', 'mod-files', 'overview', 'settings', 'about'] as const)(
    'uses file history on %s',
    async (view) => {
      mocks.workspace.currentView = view;
      await dispatch(feedbackFixture());
      expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).toHaveBeenCalledOnce();
      expect(mocks.csv[direction]).not.toHaveBeenCalled();
      expect(mocks.json[direction]).not.toHaveBeenCalled();
    },
  );
  it.each(['mod', 'session', 'view', 'table', 'page'] as const)('ends file fallback after a %s change', async (change) => {
    mocks.workspace.currentView = change === 'page' ? 'json-editor' : 'table';
    const selected = change === 'page' ? mocks.json : mocks.csv;
    let finish!: (value: null) => void;
    selected[direction].mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = dispatch(feedbackFixture());
    if (change === 'mod') mocks.workspace.activeModRoot = 'M:/beta';
    if (change === 'session') mocks.workspace.activeSessionId = 's2';
    if (change === 'view') mocks.workspace.currentView = 'about';
    if (change === 'table') mocks.tables.currentTab = 'weapons';
    if (change === 'page') mocks.workspace.jsonPage = 'skins';
    finish(null);
    await pending;
    expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).not.toHaveBeenCalled();
  });
  it('holds a locked CSV identity', async () => {
    mocks.tables.currentTableLocked = true;
    await dispatch(feedbackFixture());
    expect(mocks.csv[direction]).not.toHaveBeenCalled();
    expect(direction === 'undo' ? mocks.fileUndo : mocks.fileRedo).not.toHaveBeenCalled();
  });
});
