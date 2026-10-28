import { savedWriteFixture } from '@/test/fixtures/write-result';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback, FileChangeRecord, FileHistoryEntrySummary, WriteResult, FileHistorySnapshot } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  replayFileChangeSet: vi.fn(),
  acceptContent: vi.fn<(root: string, result: WriteResult, session: string, reason: string) => Promise<unknown[]>>().mockResolvedValue([]),
  emitWindowEvent: vi.fn(async () => {}),
  loadFileHistory: vi.fn(),
}));
vi.mock('@/services/file-history.service', async () => ({
  ...(await vi.importActual('@/services/file-history.service')),
  replayFileChangeSet: async (session: string, modRoot: string, direction: string, entryId: number, revision: number) => {
    const result = await mocks.replayFileChangeSet(session, modRoot, direction, entryId, revision);
    useFileHistoryStore().applySnapshot(modRoot, result.history);
    await mocks.acceptContent(modRoot, result, session, direction);
    return result;
  },
  loadFileHistory: mocks.loadFileHistory,
}));
vi.mock('@/windows/tauri.events', () => ({ emitWindowEvent: mocks.emitWindowEvent }));
import {
  createFileReplayPlan,
  executeFileReplayPlan,
  replayNextFileRedo,
  replayNextFileUndo,
  refreshLoadedFileHistory,
} from './file-history-replay.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';

const root = 'C:/mods/alpha';
function project(session = 's1') {
  return { getSessionId: () => session } as never;
}
function tables() {
  return { selectRowByKey: vi.fn() } as never;
}
function feedback(): AppFeedback {
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
function entry(id = 1): FileHistoryEntrySummary {
  return { id, timestamp: id, label: 'saved file', paths: ['C:/mods/alpha/notes.txt'] };
}
function change(): FileChangeRecord {
  return {
    kind: 'file',
    beforePath: entry().paths[0]!,
    afterPath: entry().paths[0]!,
    beforeExists: true,
    beforeText: 'B',
    beforeDataBase64: null,
    beforeFiles: [],
    afterExists: true,
    afterText: 'A',
    afterDataBase64: null,
    afterFiles: [],
  };
}
function savedResult(): WriteResult {
  return {
    ...savedWriteFixture(),
    changes: [change()],
    history: { revision: 2, undoStack: [], redoStack: [entry()] },
  };
}

describe('authoritative file history replay', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: root, displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModOverview(root);
    useFileHistoryStore().applySnapshot(root, { revision: 1, undoStack: [entry()], redoStack: [] });
    mocks.loadFileHistory.mockImplementation(async () => useFileHistoryStore().getHistoryStacks(root));
    mocks.acceptContent.mockResolvedValue([]);
    mocks.emitWindowEvent.mockResolvedValue(undefined);
    mocks.replayFileChangeSet.mockResolvedValue(savedResult());
  });

  it('refreshes every loaded Mod using authoritative revisions', async () => {
    const projects = useProjectStore();
    for (const [session, modRoot] of [
      ['s1', root],
      ['s2', 'C:/mods/beta'],
    ] as const) {
      const update = sessionUpdateFixture(session, modRoot);
      projects.registerProjectManifest(update.projection.manifest);
    }
    mocks.loadFileHistory.mockResolvedValue({ revision: 5, undoStack: [], redoStack: [] });
    await refreshLoadedFileHistory(() => true);
    expect(mocks.loadFileHistory).toHaveBeenCalledWith('s1', root);
    expect(mocks.loadFileHistory).toHaveBeenCalledWith('s2', 'C:/mods/beta');
    expect(useFileHistoryStore().getHistoryStacks(root).undoStack).toEqual([]);
    expect(useFileHistoryStore().getHistoryStacks('C:/mods/beta').revision).toBe(5);
    mocks.loadFileHistory.mockResolvedValue({ revision: 4, undoStack: [entry()], redoStack: [] });
    await refreshLoadedFileHistory(() => true);
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(5);
  });

  it.each(['closed', 'replaced', 'released'] as const)('rejects history delivery after its target is %s', async (reason) => {
    const projects = useProjectStore();
    const update = sessionUpdateFixture('s1', root);
    projects.registerProjectManifest(update.projection.manifest);
    let finish!: (snapshot: FileHistorySnapshot) => void;
    mocks.loadFileHistory.mockImplementationOnce(
      () =>
        new Promise<FileHistorySnapshot>((resolve) => {
          finish = resolve;
        }),
    );
    let active = true;
    const refreshing = refreshLoadedFileHistory(() => active);
    if (reason === 'closed') projects.removeProjectManifest(root);
    if (reason === 'replaced') projects.registerProjectManifest({ ...update.projection.manifest, sessionId: 's2' });
    if (reason === 'released') active = false;
    finish({ revision: 8, undoStack: [], redoStack: [] });
    await refreshing;
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
  });

  it('captures the backend history revision and entry identity', () => {
    const plan = createFileReplayPlan(project(), 'undo', root)!;
    expect(plan).toMatchObject({ sessionId: 's1', revision: 1, direction: 'undo', entry: { id: 1 } });
  });

  it('returns no plan for an empty stack or absent target', () => {
    expect(createFileReplayPlan(project(), 'redo', root)).toBeNull();
    expect(createFileReplayPlan(project(), 'undo', null)).toBeNull();
  });

  it('submits the entry id and adopts actual replay history before synchronization', async () => {
    const plan = createFileReplayPlan(project(), 'undo', root)!;
    await executeFileReplayPlan(plan, project(), tables());
    expect(mocks.replayFileChangeSet).toHaveBeenCalledWith('s1', root, 'undo', 1, 1);
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
    expect(mocks.acceptContent).toHaveBeenCalledWith(root, savedResult(), 's1', 'undo');
  });

  it('keeps committed backend history when refresh fails', async () => {
    mocks.acceptContent.mockRejectedValue(new Error('parse failed'));
    const plan = createFileReplayPlan(project(), 'undo', root)!;
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toThrow('parse failed');
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
  });

  it('preserves the projection when disk replay fails', async () => {
    mocks.replayFileChangeSet.mockRejectedValue(new Error('disk full'));
    const plan = createFileReplayPlan(project(), 'undo', root)!;
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toThrow('disk full');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
  });

  it('rejects changed session and changed history targets before writing', async () => {
    const plan = createFileReplayPlan(project(), 'undo', root)!;
    await expect(executeFileReplayPlan(plan, project('s2'), tables())).rejects.toMatchObject({ action: 'execute-file-history-replay' });
    useFileHistoryStore().applySnapshot(root, { revision: 2, undoStack: [entry(2)], redoStack: [] });
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toMatchObject({ action: 'execute-file-history-replay' });
    expect(mocks.replayFileChangeSet).not.toHaveBeenCalled();
  });

  it('requires confirmation after reading the latest backend history', async () => {
    const messages = feedback();
    expect(await replayNextFileUndo(project(), tables(), messages)).toBe(true);
    expect(mocks.loadFileHistory).toHaveBeenCalledWith('s1', root);
    expect(mocks.replayFileChangeSet).not.toHaveBeenCalled();
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(messages.success).toHaveBeenCalledWith('文件历史已撤销');
  });
  it('keeps the requested Mod when navigation changes during the history read', async () => {
    const projects = useProjectStore();
    const update = sessionUpdateFixture('s1', root);
    projects.registerProjectManifest(update.projection.manifest);
    const workspace = (await import('@/stores/workspace.store')).useWorkspaceStore();
    workspace.registerMod({ modRoot: root, displayName: 'First', version: '', status: 'ready' });
    workspace.activateModOverview(root);
    let finish!: (snapshot: FileHistorySnapshot) => void;
    mocks.loadFileHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const messages = feedback();
    const action = replayNextFileUndo(projects, tables(), messages);
    workspace.showSettings();
    finish({ revision: 1, undoStack: [entry()], redoStack: [] });
    expect(await action).toBe(true);
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(mocks.replayFileChangeSet).toHaveBeenCalledExactlyOnceWith('s1', root, 'undo', 1, 1);
  });

  it('reports replay failures through the feedback boundary', async () => {
    useFileHistoryStore().applySnapshot(root, { revision: 2, undoStack: [], redoStack: [entry()] });
    mocks.replayFileChangeSet.mockRejectedValue(new Error('disk full'));
    const messages = feedback();
    await replayNextFileRedo(project(), tables(), messages);
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(messages.error).toHaveBeenCalledWith(expect.anything(), '重做文件历史失败');
  });

  it('finishes the captured replay after switching to a different Mod during confirmation', async () => {
    const projects = useProjectStore();
    const workspace = useWorkspaceStore();
    for (const [session, modRoot] of [
      ['s1', root],
      ['s2', 'C:/mods/beta'],
    ] as const) {
      const update = sessionUpdateFixture(session, modRoot);
      projects.registerProjectManifest(update.projection.manifest);
      workspace.registerMod({ modRoot, displayName: session, version: '', status: 'ready' });
    }
    const messages = feedback();
    const table = { currentTab: 'ships', selectRowByKey: vi.fn() };
    await replayNextFileUndo(projects, table as never, messages);
    workspace.activateModOverview('C:/mods/beta');
    const result = savedResult();
    result.sessionUpdates = [sessionUpdateFixture('s1', root)];
    mocks.replayFileChangeSet.mockResolvedValueOnce(result);
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(mocks.replayFileChangeSet).toHaveBeenCalledExactlyOnceWith('s1', root, 'undo', 1, 1);
    expect(mocks.acceptContent).toHaveBeenCalledWith(root, result, 's1', 'undo');
    expect(table.selectRowByKey).not.toHaveBeenCalled();
    expect(workspace.activeSessionId).toBe('s2');
    expect(messages.success).toHaveBeenCalledExactlyOnceWith('文件历史已撤销');
  });

  it('uses the backend snapshot to reject a stale empty projection', async () => {
    mocks.loadFileHistory.mockResolvedValue({ revision: 3, undoStack: [], redoStack: [] });
    expect(await replayNextFileUndo(project(), tables(), feedback())).toBe(false);
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(3);
  });

  it('ignores an older delivered history snapshot', () => {
    useFileHistoryStore().applySnapshot(root, savedResult().history);
    useFileHistoryStore().applySnapshot(root, { revision: 1, undoStack: [entry()], redoStack: [] });
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
  });

  it('expands directory replay notifications using the actual after snapshot', async () => {
    const result = savedResult();
    result.changes = [
      {
        ...change(),
        kind: 'directory',
        beforePath: root + '/mission',
        afterPath: root + '/mission',
        beforeFiles: [{ relPath: 'old.txt', text: 'old', dataBase64: null }],
        afterFiles: [{ relPath: 'new.txt', text: 'restored', dataBase64: null }],
      },
    ];
    mocks.replayFileChangeSet.mockResolvedValue(result);
    await executeFileReplayPlan(createFileReplayPlan(project(), 'undo', root)!, project(), tables());
    expect(mocks.acceptContent).toHaveBeenCalledWith(root, result, 's1', 'undo');
  });
});
