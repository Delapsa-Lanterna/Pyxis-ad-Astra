import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { SaveDelivery, CommittedWriteEvent } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { entityTargetFixture } from '@/test/fixtures/entity-target';

const mocks = vi.hoisted(() => ({
  receive: null as null | ((message: SaveDelivery) => void),
  register: vi.fn(),
  unregister: vi.fn(),
  resolve: vi.fn(),
  wait: vi.fn(),
  abandon: vi.fn(),
  retry: vi.fn(),
  media: vi.fn(),
  query: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/services/project-sync.service', () => ({
  registerSaveWindow: mocks.register,
  unregisterSaveWindow: mocks.unregister,
  retryProjectSave: mocks.retry,
  refreshProjectSources: vi.fn(),
  resolveSaveSources: mocks.resolve,
  abandonProjectSaves: mocks.abandon,
  waitProjectSaves: mocks.wait,
}));
vi.mock('@/services/query-cache.service', () => ({ invalidateQueryCacheByProject: mocks.query }));
vi.mock('@/services/resource-media.service', () => ({ invalidateResourceMediaByProject: mocks.media }));
vi.mock('@/orchestrators/window-event-errors.orchestrator', () => ({ recordWindowEventHandlerError: mocks.report }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'main' }));

import {
  listenSavedContent,
  observeSavedContent,
  listenSavedIdentity,
  beginSavedWrite,
  retryPendingWrites,
  pauseProjectDisplay,
  releaseProjectSession,
  retryPendingSessionSyncs,
  startProjectSync,
  settleProjectSaves,
} from './project-sync.orchestrator';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';

const nativeWaits = new Map<string, (value: unknown) => void>();
async function invokeSave(request: import('@/shared/runtime/command.runtime').SaveCommandRequest) {
  return new Promise<unknown>((resolve) => nativeWaits.set(request.id, resolve));
}
const root = 'C:/mods/queue';
function event(id = 1, originWindowLabel = 'peer'): CommittedWriteEvent {
  const result = savedWriteFixture({ speed: id });

  result.requestId = 'request-' + id;
  result.history.revision = id;
  result.identityChanges = [{ before: entityTargetFixture('ship', 'before'), after: entityTargetFixture('ship', 'after') }];
  const update = sessionUpdateFixture('s1', root);
  update.projection.invalidation.paths = ['notes.txt'];
  result.sessionUpdates = [update];
  return { originWindowLabel, sessionId: 's1', modRoot: root, reason: 'save', result };
}
function deliver(value: CommittedWriteEvent) {
  mocks.receive!({ kind: 'saved', requestId: value.result.requestId!, event: value });
  nativeWaits.get(value.result.requestId!)?.(value.result);
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  mocks.register.mockImplementation(async (receive) => {
    mocks.receive = receive;
  });
  mocks.unregister.mockResolvedValue(undefined);
  nativeWaits.clear();
  mocks.retry.mockResolvedValue(undefined);
  useProjectStore().registerProjectManifest(sessionUpdateFixture('s1', root).projection.manifest);
});

describe('ordered save consumption', () => {
  it('accepts captured content once after save completion and retains a later draft', async () => {
    const session = useEditTargetDraftSession<{ speed: number }, { id: string }>({
      emptyValue: { speed: 0 },
      targetKey: (target) => target.id,
      load: () => ({ target: { id: 'a' }, value: { speed: 80 }, baseVersions: [], meta: null }),
      beginSave: beginSavedWrite,
      save: async (target, _value, _versions, _original, request) => {
        const result = (await invokeSave(request!)) as import('@/shared/types').WriteResult<{ speed: number }>;
        return { target, value: result.content!.value, baseVersions: result.baseVersions, meta: null, requestId: request!.id };
      },
    });
    session.loadBaseForTarget({ target: { id: 'a' }, value: { speed: 80 }, baseVersions: [], meta: null });
    const consumer = vi.fn((saved: CommittedWriteEvent) => {
      if (session.acceptsSaveDelivery({ id: 'a' }, saved.result.requestId))
        session.applyExternalForTarget({ target: { id: 'a' }, value: { speed: 0 }, baseVersions: [], meta: null });
    });
    await listenSavedContent(consumer);
    session.setDraft({ speed: 100 });
    const saving = session.saveDraft();
    await flushPromises();
    const id = [...nativeWaits.keys()][0]!;
    session.setDraft({ speed: 80 });
    const saved = event(100);
    saved.result.requestId = id;
    deliver(saved);
    await saving;
    await flushPromises();
    expect(session.baselineSnapshot.value!.value.speed).toBe(100);
    expect(session.draftValue.value.speed).toBe(80);
    expect(session.pendingSnapshot.value).toBeNull();
    expect(consumer).toHaveBeenCalledOnce();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it.each([true, false])('settles project recovery with explicit abandon choice %s', async (abandon) => {
    const error = {
      code: 'io.unexpected',
      message: 'restore unavailable',
      location: { path: root + '/notes.txt', line: null, column: null },
    };
    mocks.wait.mockRejectedValueOnce(error).mockResolvedValue(undefined);
    useProjectSyncStore().setBlocked({ kind: 'blocked', modRoot: root, sessionId: 's1', requestId: 'restore', diagnostic: error });
    const choose = vi.fn().mockResolvedValue(abandon ? 'abandon' : null);
    const result = settleProjectSaves({ kind: 'sessions', sessionIds: ['s1'] }, {
      choose,
    } as unknown as import('@/shared/types').AppFeedback);
    if (abandon) {
      await result;
      expect(mocks.abandon).toHaveBeenCalledExactlyOnceWith([root]);
      expect(mocks.wait).toHaveBeenCalledTimes(2);
    } else {
      await expect(result).rejects.toBe(error);
      expect(mocks.abandon).not.toHaveBeenCalled();
    }
    expect(choose.mock.calls[0]![0].content).toContain('restore unavailable');
  });
  it.each(['recreate', null])('asks about exact missing sources and returns the user choice %s', async (choice) => {
    const choose = vi.fn().mockResolvedValue(choice);
    await startProjectSync({ choose } as unknown as import('@/shared/types').AppFeedback);
    mocks.receive!({ kind: 'missing', requestId: 'missing', paths: ['C:/mods/queue/notes.txt'] });
    await flushPromises();
    expect(choose.mock.calls[0]![0].content).toContain('C:/mods/queue/notes.txt');
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('missing', ['C:/mods/queue/notes.txt'], choice === 'recreate');
  });

  it('completes the save while content continues and retries reading separately', async () => {
    const content = vi.fn().mockRejectedValueOnce(new Error('read')).mockResolvedValue(undefined);
    await listenSavedContent(content);
    const operation = beginSavedWrite(invokeSave, () => []);
    await flushPromises();
    const saved = event();
    saved.result.requestId = operation.id;
    deliver(saved);
    await expect(operation.result).resolves.toBe(saved.result);
    await flushPromises();
    expect(useProjectSyncStore().pending).toHaveLength(1);
    await retryPendingWrites();
    expect(content).toHaveBeenCalledTimes(2);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });

  it('keeps one source wait through project recovery and ends it with the actual result', async () => {
    const operation = beginSavedWrite(invokeSave, () => []);
    let finished = false;
    void operation.result.then(() => {
      finished = true;
    });
    await flushPromises();
    mocks.receive!({
      kind: 'blocked',
      requestId: operation.id,
      modRoot: root,
      sessionId: 's1',
      diagnostic: { code: 'io.unexpected', message: 'restore', location: null },
    });
    await flushPromises();
    expect(finished).toBe(false);
    const saved = event();
    saved.result.requestId = operation.id;
    deliver(saved);
    await operation.result;
    await flushPromises();
    expect(finished).toBe(true);
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });

  it('updates current content after a failed older delivery without replaying the old snapshot', async () => {
    const observed: number[] = [];
    const receive = vi.fn((saved: CommittedWriteEvent) => {
      observed.push(saved.result.history.revision);
      if (saved.result.history.revision === 1) throw new Error('read');
    });
    await listenSavedContent(receive);
    deliver(event(1));
    await flushPromises();
    deliver(event(2));
    await flushPromises();
    expect(observed).toEqual([1, 2]);
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(2);
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });

  it('owns one channel per window and keeps content subscriptions independent', async () => {
    const first = vi.fn(),
      second = vi.fn();
    const stop = observeSavedContent(first);
    await listenSavedContent(second);
    stop();
    deliver(event());
    await flushPromises();
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it('accepts history and invalidates caches once before waiting for identity and content', async () => {
    const order: string[] = [];
    mocks.media.mockImplementation(() => order.push('media'));
    mocks.query.mockImplementation(() => order.push('cache'));
    const history = vi.spyOn(useFileHistoryStore(), 'applySnapshot');
    await listenSavedIdentity(async () => {
      order.push('identity');
      await Promise.resolve();
      order.push('identity-ready');
    });
    await listenSavedContent(() => {
      order.push('content');
    });
    deliver(event());
    await flushPromises();
    expect(order).toEqual(['media', 'cache', 'identity', 'identity-ready', 'content']);
    expect(history).toHaveBeenCalledOnce();
  });
  it('consumes two distinct saves in delivered order', async () => {
    const receive = vi.fn();
    await listenSavedContent(receive);
    deliver(event(1));
    await flushPromises();
    deliver(event(2));
    await flushPromises();
    expect(receive.mock.calls.map(([event]) => event.result.requestId)).toEqual(['request-1', 'request-2']);
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
  it('finishes the current event before beginning the next delivered event', async () => {
    let finish!: () => void;
    const order: number[] = [];
    await listenSavedContent(async (event) => {
      const id = Number(event.result.requestId!.split('-').at(-1));
      order.push(id);
      if (id === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    deliver(event(1));
    deliver(event(2));
    await flushPromises();
    expect(order).toEqual([1]);
    finish();
    await flushPromises();
    expect(order).toEqual([1, 2]);
  });
  it('runs source acceptance inside the ordered consumer and retries its unfinished step', async () => {
    const order: string[] = [];
    await listenSavedContent(() => {
      order.push('content');
    });
    const accept = vi
      .fn()
      .mockRejectedValueOnce(new Error('source'))
      .mockImplementationOnce(async () => {
        order.push('source');
      });
    const operation = beginSavedWrite(invokeSave, () => [accept]);
    const saved = event(1, 'main');
    saved.result.requestId = operation.id;
    const finished = operation.result;
    await flushPromises();
    deliver(saved);
    await finished;
    await flushPromises();
    expect(order).toEqual([]);
    await retryPendingWrites();
    expect(accept).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['source', 'content']);
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it('continues only unfinished tasks after a content failure', async () => {
    const first = vi.fn(),
      last = vi.fn();
    const failing = vi.fn().mockRejectedValueOnce(new Error('content')).mockResolvedValue(undefined);
    await listenSavedContent(first);
    await listenSavedContent(failing);
    await listenSavedContent(last);
    deliver(event());
    await flushPromises();
    expect(first).toHaveBeenCalledOnce();
    expect(last).not.toHaveBeenCalled();
    expect(useProjectSyncStore().pending[0]?.error?.message).toBe('content');
    await retryPendingSessionSyncs('s1');
    await flushPromises();
    expect(first).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(last).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it('retains pending content until its asynchronous consumer completes', async () => {
    let finish!: () => void;
    await listenSavedContent(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    deliver(event());
    await flushPromises();
    expect(useProjectSyncStore().pending).toHaveLength(1);
    finish();
    await flushPromises();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it('registers the originating acceptance before dispatch and shares its completion promise', async () => {
    const receive = vi.fn(),
      identity = vi.fn(),
      accept = vi.fn();
    await listenSavedIdentity(identity);
    await listenSavedContent(receive);
    const operation = beginSavedWrite(invokeSave, () => [accept]);
    const one = operation.result,
      two = operation.result;
    expect(one).toBe(two);
    const saved = event(1, 'main');
    saved.result.requestId = operation.id;
    await flushPromises();
    deliver(saved);
    await Promise.all([one, two]);
    await flushPromises();
    expect(accept).toHaveBeenCalledOnce();
    expect(receive).toHaveBeenCalledOnce();
    expect(identity).toHaveBeenCalledOnce();
    expect(useProjectSyncStore().pending).toHaveLength(0);
  });
  it('keeps paused identity work unfinished until resume and successful acceptance', async () => {
    const order: string[] = [];
    const identity = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('failed-identity');
        throw new Error('identity');
      })
      .mockImplementationOnce(async () => {
        order.push('identity');
      });
    await listenSavedIdentity(identity);
    await listenSavedContent(() => {
      order.push('content');
    });
    const resume = pauseProjectDisplay();
    deliver(event());
    await flushPromises();
    expect(order).toEqual([]);
    await resume();
    await flushPromises();
    expect(order).toEqual(['failed-identity']);
    await retryPendingSessionSyncs('s1');
    await flushPromises();
    expect(order).toEqual(['failed-identity', 'identity', 'content']);
  });
  it('resumes each nested close pause independently', async () => {
    const receive = vi.fn();
    await listenSavedContent(receive);
    const outer = pauseProjectDisplay();
    const inner = pauseProjectDisplay();
    deliver(event());
    await outer();
    await flushPromises();
    expect(receive).not.toHaveBeenCalled();
    await inner();
    await flushPromises();
    expect(receive).toHaveBeenCalledOnce();
  });
  it('accepts the complete manifest supplied by the saved event', async () => {
    const receive = vi.fn();
    await listenSavedContent(receive);
    const saved = event();
    saved.result.sessionUpdates[0]!.projection.manifest.modInfo = { id: 'prepared' };
    deliver(saved);
    await flushPromises();
    expect(receive).toHaveBeenCalledOnce();
    expect(useProjectStore().getManifest(root)!.modInfo).toEqual({ id: 'prepared' });
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it('retries a blocked request with no session', async () => {
    await startProjectSync();
    mocks.receive!({
      kind: 'blocked',
      requestId: 'recovery',
      modRoot: root,
      sessionId: null,
      diagnostic: { code: 'io.unexpected', message: 'disk', location: null },
    });
    mocks.retry.mockImplementationOnce(async () => mocks.receive!({ kind: 'waiting', modRoot: root, waiting: true }));
    await retryPendingWrites();
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith('recovery');
    expect(useProjectSyncStore().blocked).toHaveLength(0);
  });
  it('releases every content owner before reporting a release error', async () => {
    const released = vi.fn();
    await listenSavedContent(vi.fn(), () => {
      throw new Error('release');
    });
    await listenSavedContent(vi.fn(), released);
    expect(() => releaseProjectSession('s1')).toThrow(AggregateError);
    expect(released).toHaveBeenCalledExactlyOnceWith('s1');
  });
  it('projects native waiting status per project', async () => {
    await startProjectSync();
    mocks.receive!({ kind: 'waiting', modRoot: root, waiting: true });
    expect(useProjectSyncStore().isWaiting(root.toUpperCase())).toBe(true);
    expect(useProjectSyncStore().isWaiting('C:/mods/other')).toBe(false);
    mocks.receive!({ kind: 'waiting', modRoot: root, waiting: false });
    expect(useProjectSyncStore().isWaiting(root)).toBe(false);
  });
  it('retains a blocked write until its native retry resumes the same request', async () => {
    await startProjectSync();
    mocks.receive!({
      kind: 'blocked',
      modRoot: root,
      requestId: 'disk',
      sessionId: 's1',
      diagnostic: { code: 'io.unexpected', message: 'disk', location: null },
    });
    expect(useProjectSyncStore().blocked).toHaveLength(1);
    mocks.retry.mockImplementationOnce(async () => mocks.receive!({ kind: 'waiting', modRoot: root, waiting: true }));
    await retryPendingSessionSyncs('s1');
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith('disk');
    expect(useProjectSyncStore().blocked).toHaveLength(0);
    expect(useProjectSyncStore().isWaiting(root)).toBe(true);
  });

  it('keeps one local content failure and retries without invoking project recovery', async () => {
    const receive = vi.fn().mockRejectedValueOnce(new Error('content')).mockResolvedValue(undefined);
    await listenSavedContent(receive);
    deliver(event());
    await flushPromises();
    const sync = useProjectSyncStore();
    expect(sync.pending).toHaveLength(1);
    expect(sync.blocked).toHaveLength(1);
    expect(sync.blocked[0]!.diagnostic).toBe(sync.pending[0]!.error);
    await retryPendingWrites();
    await flushPromises();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(receive).toHaveBeenCalledTimes(2);
    expect(sync.pending).toHaveLength(0);
    expect(sync.blocked).toHaveLength(0);
  });

  it('completing an ended source preserves another request waiting in the same window', async () => {
    const sync = useProjectSyncStore();
    sync.receive({ id: 'other', event: event(2), tasks: [], running: null, error: null });
    sync.complete('already-ended');
    expect(sync.pending.map((work) => work.id)).toEqual(['other']);
  });

  it('window release ends all source waiters and releases its content work', async () => {
    const release = await startProjectSync();
    const operation = beginSavedWrite(invokeSave, () => []);
    const first = expect(operation.result).rejects.toMatchObject({ code: 'write.window_destroyed' });
    const second = expect(operation.result).rejects.toMatchObject({ code: 'write.window_destroyed' });
    await flushPromises();
    release();
    await Promise.all([first, second]);
    expect(useProjectSyncStore().pending).toHaveLength(0);
    expect(useProjectSyncStore().blocked).toHaveLength(0);
    expect(mocks.unregister).toHaveBeenCalledOnce();
  });
});
