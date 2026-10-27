import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectManifest, ProjectSessionInvalidationResult, WriteResult, CommittedSessionUpdate, ProjectChange } from '@/shared/types';
import type { ProjectSessionInvalidatedEvent, CommittedWriteEvent } from '@/windows/window.events';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
const mocks = vi.hoisted(() => ({
  synchronizeSessionCommit: vi.fn(),
  refreshProjectSources: vi.fn(),
  recordLogBestEffort: vi.fn(),
  invalidateQueryCacheByProject: vi.fn(),
  invalidateResourceMediaByProject: vi.fn(),
  emitWindowEvent: vi.fn(),
  handler: null as null | ((event: CommittedWriteEvent) => Promise<void>),
  refreshHandler: null as null | ((event: ProjectSessionInvalidatedEvent & { originWindowLabel: string }) => Promise<void>),
}));
vi.mock('@/services/project-sync.service', () => ({
  synchronizeSessionCommit: mocks.synchronizeSessionCommit,
  refreshProjectSources: mocks.refreshProjectSources,
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.recordLogBestEffort }));
vi.mock('@/services/query-cache.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/query-cache.service')>();
  return { ...actual, invalidateQueryCacheByProject: mocks.invalidateQueryCacheByProject };
});
vi.mock('@/services/resource-media.service', () => ({ invalidateResourceMediaByProject: mocks.invalidateResourceMediaByProject }));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'main' }));
vi.mock('@/windows/tauri.events', () => ({
  emitWindowEvent: mocks.emitWindowEvent,
  listenWindowEvent: vi.fn(async (_name, handler) => {
    if (_name === 'project-sources-refreshed') mocks.refreshHandler = handler;
    else mocks.handler = handler;
    return () => {
      if (_name === 'project-sources-refreshed') mocks.refreshHandler = null;
      else mocks.handler = null;
    };
  }),
}));
import {
  publishCommittedWrite,
  retryPendingSessionSyncs,
  listenCommittedWrites,
  completeSavedWrite,
  listenEntityIdentityApplied,
  listenProjectChanges,
  subscribeProjectChanges,
  releaseProjectSession,
  pauseProjectDisplay,
  refreshProjectSourcePaths,
  invalidateProjectionCaches,
} from './project-sync.orchestrator';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { removeModRuntimeState } from '@/orchestrators/workspace-lifecycle.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { requireProjectionReady, markProjectionReady } from '@/services/project-projection.service';
import { createCachedSessionQuery, invalidateQueryCacheForSession } from '@/services/query-cache.service';
function manifestFixture(modRoot: string, sessionId: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: {
      factions: 0,
      missions: 0,
      ships: 0,
      weapons: 0,
      projectiles: 0,
      variants: 0,
      skins: 0,
      systems: 0,
      skills: 0,
    },
    warnings: [],
  };
}

const root = 'C:/mods/alpha';
function projection(revision = 1): ProjectSessionInvalidationResult {
  return {
    projectionRevision: revision,
    manifest: { ...manifestFixture(root, 's1'), modInfo: { name: 'projection-' + revision } },
    invalidation: { paths: ['notes.txt'], tables: [], entities: [], resources: [], queryScopes: [], session: false },
  };
}
function receipt(commitId = 1, ready = true): WriteResult {
  const result = savedWriteFixture();
  result.commitId = commitId;
  result.history = {
    revision: commitId,
    undoStack: [{ id: commitId, timestamp: 0, label: 'notes', paths: [root + '/notes.txt'] }],
    redoStack: [],
  };
  result.changes = [
    {
      kind: 'file',
      beforePath: root + '/notes.txt',
      afterPath: root + '/notes.txt',
      beforeExists: true,
      beforeText: 'old',
      beforeDataBase64: null,
      beforeFiles: [],
      afterExists: true,
      afterText: 'new',
      afterDataBase64: null,
      afterFiles: [],
    },
  ];
  result.sessionUpdates = [
    ready
      ? { sessionId: 's1', modRoot: root, commitId, status: 'ready', projection: projection(commitId) }
      : { sessionId: 's1', modRoot: root, commitId, status: 'pending', error: { code: 'parse.json', message: 'bad spec', location: null } },
  ];
  return result;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.handler = null;
  mocks.refreshHandler = null;
  mocks.emitWindowEvent.mockResolvedValue(undefined);
  useProjectStore().registerProjectManifest(manifestFixture(root, 's1'));
});
afterEach(() => markProjectionReady('s1'));

describe('one business change delivery', () => {
  it('updates child windows without a local manifest and retains distinct out-of-order change scopes', async () => {
    useProjectStore().removeProjectManifest(root);
    const receive = vi.fn();
    const stop = await listenProjectChanges(receive);
    const late = receipt(1);
    if (late.sessionUpdates[0]!.status === 'ready') late.sessionUpdates[0]!.projection.invalidation.paths = ['other.txt'];
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt(2) });
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: late });
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls.map(([change]) => change.event.result.commitId)).toEqual([2, 1]);
    expect(mocks.invalidateQueryCacheByProject.mock.calls.map(([, invalidation]) => invalidation.paths)).toEqual([
      ['notes.txt'],
      ['other.txt'],
    ]);
    stop();
  });
  it('delivers local acceptance once before broadcast and ignores its echo and retry', async () => {
    const receive = vi.fn();
    const stop = await listenProjectChanges(receive);
    const result = receipt();
    mocks.emitWindowEvent.mockRejectedValueOnce(new Error('broadcast'));
    await expect(publishCommittedWrite(root, result, 's1')).rejects.toThrow('broadcast');
    expect(receive).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'commit', event: expect.objectContaining({ result }) }),
    );
    await retryPendingSessionSyncs('s1');
    await mocks.handler!({ originWindowLabel: 'main', sessionId: 's1', modRoot: root, reason: 'save', result });
    expect(receive).toHaveBeenCalledOnce();
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
    stop();
  });
  it('retries only failed consumers and preserves the order through identity acceptance', async () => {
    const order: string[] = [];
    const identityStop = await listenCommittedWrites(
      async () => {
        order.push('identity');
      },
      () => true,
      'identity',
    );
    const first = vi.fn(() => {
      order.push('first');
    });
    const second = vi.fn().mockImplementationOnce(() => {
      throw new Error('consumer');
    });
    const stopFirst = await listenProjectChanges(first),
      stopSecond = await listenProjectChanges(second);
    const event: CommittedWriteEvent = { originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'undo', result: receipt() };
    await expect(mocks.handler!(event)).rejects.toThrow('Project change delivery');
    await mocks.handler!(event);
    expect(order).toEqual(['identity', 'first']);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    identityStop();
    stopFirst();
    stopSecond();
  });
  it('shares listeners, releases them before registration finishes and continues remaining subscribers', async () => {
    const receive = vi.fn();
    const stopEarly = subscribeProjectChanges(vi.fn()),
      stop = await listenProjectChanges(receive);
    stopEarly();
    await mocks.refreshHandler!({ ...projection(1), originWindowLabel: 'peer' });
    await mocks.refreshHandler!({ ...projection(1), originWindowLabel: 'peer' });
    expect(receive).toHaveBeenCalledOnce();
    stop();
    expect(mocks.handler).toBeNull();
    expect(mocks.refreshHandler).toBeNull();
  });
  it('deduplicates projections and delivers closure immediately while display updates are paused', async () => {
    const receive = vi.fn();
    const stop = await listenProjectChanges(receive);
    await mocks.refreshHandler!({ ...projection(3), originWindowLabel: 'peer' });
    await mocks.refreshHandler!({ ...projection(3), originWindowLabel: 'peer' });
    expect(receive).toHaveBeenCalledOnce();
    const resume = pauseProjectDisplay();
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'redo', result: receipt(4) });
    releaseProjectSession('s1');
    expect(receive.mock.lastCall![0]).toEqual({ kind: 'closed', sessionId: 's1' });
    await resume();
    expect(receive).toHaveBeenCalledTimes(2);
    stop();
  });
  it('delivers a source refresh once in the originating window', async () => {
    const receive = vi.fn<(change: ProjectChange) => void>();
    const stop = await listenProjectChanges(receive);
    mocks.refreshProjectSources.mockResolvedValueOnce(projection(5));
    await refreshProjectSourcePaths('s1', root, [root + '/notes.txt']);
    await mocks.refreshHandler!({ ...projection(5), originWindowLabel: 'main' });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ kind: 'refresh', projection: projection(5) });
    stop();
  });
});

describe('committed write synchronization', () => {
  it('projects replay identity through the shared committed-write subscription', async () => {
    const result = receipt();
    result.identityChanges = [{ before: entityTargetFixture('variant', 'old'), after: entityTargetFixture('variant', 'next') }];
    const receive = vi.fn();
    const stop = await listenEntityIdentityApplied(receive);
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'undo', result });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', modRoot: root, result });
    stop();
    expect(mocks.handler).toBeNull();
  });
  it('keeps an identity query alive when the received receipt invalidates its destination', async () => {
    const actual = await vi.importActual<typeof import('@/services/query-cache.service')>('@/services/query-cache.service');
    mocks.invalidateQueryCacheByProject.mockImplementationOnce(actual.invalidateQueryCacheByProject);
    let finish!: (value: []) => void;
    const ready = vi.fn();
    const stop = await listenCommittedWrites(
      async () => {
        const value = await createCachedSessionQuery<{ kind: 'ship' }, []>({
          queryKind: 'entity-list',
          load: () =>
            new Promise<[]>((resolve) => {
              finish = resolve;
            }),
          invalidates: () => true,
        })('s1', { kind: 'ship' });
        ready(value);
      },
      () => true,
      'identity',
    );
    const result = receipt();
    result.sessionUpdates[0] = {
      sessionId: 's1',
      modRoot: root,
      commitId: 1,
      status: 'ready',
      projection: {
        ...projection(),
        invalidation: {
          ...projection().invalidation,
          queryScopes: [{ kind: 'entity-list', entity: { kind: 'ship', id: null }, table: null, source: null, resource: null }],
        },
      },
    };
    const receiving = mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result });
    const completed = expect(receiving).resolves.toBeUndefined();
    await Promise.resolve();
    finish([]);
    await completed;
    expect(ready).toHaveBeenCalledExactlyOnceWith([]);
    stop();
    invalidateQueryCacheForSession('s1');
  });
  it('accepts the transaction projection and history then invalidates resources before queries', async () => {
    const written = receipt();
    await publishCommittedWrite(root, written, 's1');
    expect(mocks.synchronizeSessionCommit).not.toHaveBeenCalled();
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-1');
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(written.history);
    expect(mocks.invalidateResourceMediaByProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateQueryCacheByProject.mock.invocationCallOrder[0]!,
    );
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith(
      'committed-write-applied',
      expect.objectContaining({ originWindowLabel: 'main', result: written, reason: 'save' }),
    );
  });
  it('retains pending projection failures and resumes their exact backend commit', async () => {
    mocks.synchronizeSessionCommit.mockRejectedValueOnce(new Error('parse failed'));
    await expect(publishCommittedWrite(root, receipt(1, false), 's1')).rejects.toThrow('parse failed');
    expect(useProjectSyncStore().pending[0]).toMatchObject({ step: 'projection', event: { result: { commitId: 1 } } });
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
    expect(() => requireProjectionReady('s1')).toThrow('Session projection pending');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).not.toHaveBeenCalled();
    mocks.synchronizeSessionCommit.mockResolvedValueOnce(receipt().sessionUpdates[0]);
    await retryPendingSessionSyncs('s1');
    expect(mocks.synchronizeSessionCommit).toHaveBeenLastCalledWith('s1', root, 1);
    expect(useProjectSyncStore().pending).toHaveLength(0);
    expect(() => requireProjectionReady('s1')).not.toThrow();
  });
  it('retries broadcast using the completed local acceptance and projection', async () => {
    mocks.emitWindowEvent.mockRejectedValueOnce(new Error('broadcast'));
    await expect(publishCommittedWrite(root, receipt(), 's1')).rejects.toThrow('broadcast');
    expect(useProjectSyncStore().pending[0]?.step).toBe('broadcast');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
    await retryPendingSessionSyncs('s1');
    expect(mocks.synchronizeSessionCommit).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
    expect(mocks.emitWindowEvent).toHaveBeenCalledTimes(2);
  });
  it('shares a running operation for the same committed receipt', async () => {
    let release!: () => void;
    mocks.emitWindowEvent.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const written = receipt();
    const first = publishCommittedWrite(root, written, 's1');
    const second = publishCommittedWrite(root, written, 's1');
    expect(useProjectSyncStore().pending).toHaveLength(1);
    await vi.waitFor(() => expect(mocks.emitWindowEvent).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
  it('deduplicates received receipts and keeps the highest manifest projection', async () => {
    const handler = vi.fn();
    const stop = await listenCommittedWrites(handler);
    const latest: CommittedWriteEvent = { originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt(2) };
    await mocks.handler!(latest);
    await mocks.handler!(latest);
    await mocks.handler!({ ...latest, result: receipt(1) });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-2');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(2);
    stop();
  });
  it('invalidates caches before identity reads and waits for identity before projection delivery', async () => {
    const sequence: string[] = [];
    mocks.invalidateQueryCacheByProject.mockImplementationOnce(() => sequence.push('cache'));
    await listenCommittedWrites(
      async () => {
        sequence.push('identity');
        await Promise.resolve();
        sequence.push('identity-ready');
      },
      () => true,
      'identity',
    );
    await listenCommittedWrites(async () => {
      sequence.push('projection');
    });
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() });
    expect(sequence).toEqual(['cache', 'identity', 'identity-ready', 'projection']);
  });
  it('shares concurrent delivery of one receipt until identity acceptance completes', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => (finish = resolve));
    const identity = vi.fn(() => waiting);
    const dependent = vi.fn();
    const stopIdentity = await listenCommittedWrites(identity, () => true, 'identity');
    const stopDependent = await listenCommittedWrites(dependent);
    const event: CommittedWriteEvent = { originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() };
    const first = mocks.handler!(event);
    const duplicate = mocks.handler!(event);
    const beforeCompletion = dependent.mock.calls.length;
    finish();
    await Promise.all([first, duplicate]);
    expect(beforeCompletion).toBe(0);
    expect(identity).toHaveBeenCalledOnce();
    expect(dependent).toHaveBeenCalledOnce();
    stopIdentity();
    stopDependent();
  });
  it('releases a projection subscriber while identity delivery is awaiting confirmation', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => (finish = resolve));
    const stopIdentity = await listenCommittedWrites(
      () => waiting,
      () => true,
      'identity',
    );
    const dependent = vi.fn();
    const stopDependent = await listenCommittedWrites(dependent);
    const delivery = mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() });
    stopDependent();
    finish();
    await delivery;
    expect(dependent).not.toHaveBeenCalled();
    stopIdentity();
  });
  it('filters an older session before applying domain notifications', async () => {
    const handler = vi.fn();
    await listenCommittedWrites(handler);
    removeModRuntimeState(root);
    useProjectStore().registerProjectManifest(manifestFixture(root, 's2'));
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).not.toHaveBeenCalled();
  });
  it('leaves the source window echo at the committed local state', async () => {
    const handler = vi.fn();
    await listenCommittedWrites(handler);
    const written = receipt();
    await publishCommittedWrite(root, written, 's1');
    await mocks.handler!({ originWindowLabel: 'main', sessionId: 's1', modRoot: root, reason: 'save', result: written });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
  it('ends a removed-session retry before accepting an older response', async () => {
    let restore!: (update: CommittedSessionUpdate) => void;
    mocks.synchronizeSessionCommit.mockImplementationOnce(() => new Promise((resolve) => (restore = resolve)));
    const syncing = publishCommittedWrite(root, receipt(1, false), 's1');
    removeModRuntimeState(root);
    useProjectStore().registerProjectManifest(manifestFixture(root, 's2'));
    restore(receipt().sessionUpdates[0]!);
    await syncing;
    expect(useProjectStore().getSessionId(root)).toBe('s2');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
  });
  it('accepts zero-change credentials with the current projection', async () => {
    const written = { ...receipt(), changes: [] };
    await publishCommittedWrite(root, written, 's1');
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-1');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
  });
  it('completes a saved receipt through the shared submission lifecycle', async () => {
    const written = receipt();
    await completeSavedWrite({ modRoot: root, sessionId: 's1', result: written, label: 'saved' });
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(written.history);
    expect(useProjectSyncStore().pending).toHaveLength(0);
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith('committed-write-applied', expect.objectContaining({ result: written }));
  });
  it('completes a zero-change saved receipt with its credentials and projection', async () => {
    await completeSavedWrite({ modRoot: root, sessionId: 's1', result: { ...receipt(), changes: [] }, label: 'saved' });
    expect(useProjectSyncStore().pending).toHaveLength(0);
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-1');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
  });
  it('retains a persisted synchronization failure with one diagnostic', async () => {
    mocks.emitWindowEvent.mockRejectedValueOnce(new Error('broadcast'));
    await expect(completeSavedWrite({ modRoot: root, sessionId: 's1', result: receipt(), label: 'saved' })).rejects.toMatchObject({
      action: 'sync-saved-write',
    });
    expect(useProjectSyncStore().pending[0]).toMatchObject({ step: 'broadcast' });
    expect(mocks.recordLogBestEffort).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: 'write.sync_pending', path: root, fields: { sessionId: 's1' } }),
    );
    await retryPendingSessionSyncs('s1');
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
});

describe('project source refresh', () => {
  it('accepts source and save notifications through one projection subscription and releases both listeners', async () => {
    const receive = vi.fn();
    const stop = await listenProjectChanges((change) => {
      if (change.kind !== 'closed') receive(change.projection);
    });
    await mocks.refreshHandler!({ ...projection(3), originWindowLabel: 'peer' });
    const result = receipt(4);
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result });
    expect(receive.mock.calls.map(([event]) => event.projectionRevision)).toEqual([3, 4]);
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-4');
    expect(useProjectSyncStore().wereProjectionCachesInvalidated('s1', 4)).toBe(true);
    stop();
    expect(mocks.handler).toBeNull();
    expect(mocks.refreshHandler).toBeNull();
  });
  it('releases only the closing session projection records', () => {
    invalidateProjectionCaches(projection());
    invalidateProjectionCaches({ ...projection(), manifest: { ...projection().manifest, sessionId: 's2', modRoot: 'C:/mods/beta' } });
    removeModRuntimeState(root);
    const sync = useProjectSyncStore();
    expect(sync.wereProjectionCachesInvalidated('s1', 1)).toBe(false);
    expect(sync.wereProjectionCachesInvalidated('s2', 1)).toBe(true);
  });
  it('captures and deduplicates Mod and Core sources in the formal request', async () => {
    mocks.refreshProjectSources.mockResolvedValueOnce(projection());
    await refreshProjectSourcePaths(
      's1',
      root,
      [root + '/notes.txt', 'G:/game/starsector-core/graphics/demo.png'],
      [{ source: 'mod', relPath: 'notes.txt' }],
    );
    expect(mocks.refreshProjectSources).toHaveBeenCalledExactlyOnceWith('s1', [
      { source: 'mod', relPath: 'notes.txt' },
      { source: 'core', relPath: 'graphics/demo.png' },
    ]);
  });
  it('accepts and broadcasts an in-flight source refresh after its page leaves', async () => {
    let finish!: (value: ProjectSessionInvalidationResult) => void;
    mocks.refreshProjectSources.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const action = refreshProjectSourcePaths('s1', root, [root + '/notes.txt']);
    useWorkspaceStore().showSettings();
    finish(projection(3));
    await action;
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-3');
    expect(mocks.emitWindowEvent).toHaveBeenCalledExactlyOnceWith(
      'project-sources-refreshed',
      expect.objectContaining({ projectionRevision: 3 }),
    );
    expect(mocks.refreshProjectSources).toHaveBeenCalledWith('s1', [{ source: 'mod', relPath: 'notes.txt' }]);
  });
  it.each(['success', 'failure'] as const)('ends a source-refresh %s when its session closes', async (outcome) => {
    let finish!: (value: ProjectSessionInvalidationResult) => void;
    let fail!: (error: Error) => void;
    mocks.refreshProjectSources.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const action = refreshProjectSourcePaths('s1', root, [root + '/notes.txt']);
    invalidateQueryCacheForSession('s1');
    removeModRuntimeState(root);
    useProjectStore().registerProjectManifest(manifestFixture(root, 's2'));
    if (outcome === 'success') finish(projection());
    else fail(new Error('closed session'));
    await action;
    expect(useProjectStore().getSessionId(root)).toBe('s2');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
    expect(mocks.invalidateResourceMediaByProject).not.toHaveBeenCalled();
  });
  it('applies one received projection only once across consumers', () => {
    invalidateProjectionCaches(projection());
    invalidateProjectionCaches(projection());
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
  it('releases projection acceptance markers together with the owning Mod runtime', () => {
    invalidateProjectionCaches(projection());
    expect(useProjectSyncStore().wereProjectionCachesInvalidated('s1', 1)).toBe(true);
    removeModRuntimeState(root);
    expect(useProjectSyncStore().wereProjectionCachesInvalidated('s1', 1)).toBe(false);
  });
});
