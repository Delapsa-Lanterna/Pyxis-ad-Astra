vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  observeCoreContent: (
    handler: (root: string, sources: readonly { source: 'core'; relPath: string }[]) => (() => Promise<void>)[] | undefined,
  ) => {
    const receive = async (root: string, sources: readonly { source: 'core'; relPath: string }[]) => {
      const results = await Promise.allSettled((handler(root, sources) ?? []).map((task) => task()));
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length)
        throw new AggregateError(
          failed.map((result) => result.reason),
          'Core content acceptance failed',
        );
    };
    mocks.coreChanged.add(receive);
    return { ready: Promise.resolve(), release: () => mocks.coreChanged.delete(receive) };
  },
}));
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, ref, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startCoreAssetsLoading, loadCoreFields, loadCoreGraphics, refreshCoreAssets } from '@/orchestrators/core-assets.orchestrator';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { useCoreGraphics } from './use-core-assets';
import { useCoreSchema } from './use-core-schema';
import type { DiscoveredField } from '@/shared/types';
import { dispatchProjectChangeFixture, projectChangeListeners } from '@/test/unit/project-changes';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  fields: vi.fn(),
  graphics: vi.fn(),
  log: vi.fn(),
  clear: vi.fn(),
  setSource: vi.fn(async () => {}),
  coreChanged: new Set<(root: string, sources: readonly { source: 'core'; relPath: string }[]) => Promise<void>>(),
}));
vi.mock('@/services/core-assets.service', () => ({
  queryCoreFields: mocks.fields,
  queryCoreGraphics: mocks.graphics,
  invalidateCoreCacheForRoot: mocks.clear,
  setWindowCoreSubscription: mocks.setSource,
}));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
const fields: Record<string, DiscoveredField[]> = { faction: [{ key: 'bonus', type: 'string', origin: 'core' }] };
let stop: () => void;
let scope: ReturnType<typeof effectScope>;
let root: Ref<string | null>;

beforeEach(() => {
  setActivePinia(createPinia());
  root = ref<string | null>('D:/A');
  vi.clearAllMocks();
  mocks.fields.mockResolvedValue(fields);
  mocks.graphics.mockResolvedValue(['graphics/a.png']);
  scope = effectScope();
  stop = scope.run(() => startCoreAssetsLoading(root))!;
});
afterEach(() => {
  stop();
  scope.stop();
});

describe('Core asset ownership and acceptance', () => {
  it('source watch review establishes the initial root subscription before reading a product', async () => {
    stop();
    await flushPromises();
    let subscribed!: () => void;
    mocks.setSource.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          subscribed = resolve;
        }),
    );
    stop = scope.run(() => startCoreAssetsLoading(root))!;
    await flushPromises();
    const pending = loadCoreGraphics();
    onTestFinished(async () => {
      subscribed();
      await pending;
    });
    await flushPromises();
    expect(mocks.graphics).toHaveBeenCalledTimes(0);
    subscribed();
    await pending;
    expect(mocks.graphics).toHaveBeenCalledExactlyOnceWith('D:/A');
  });
  it('source watch review refreshes graphics when the same batch fails field loading', async () => {
    await Promise.all([loadCoreFields(), loadCoreGraphics()]);
    mocks.fields.mockRejectedValueOnce(new Error('review fields failure'));
    mocks.graphics.mockResolvedValueOnce(['graphics/review.png']);
    const results = await Promise.allSettled(
      [...mocks.coreChanged].map((receive) =>
        receive('D:/A', [
          { source: 'core', relPath: 'data/hulls' },
          { source: 'core', relPath: 'graphics' },
        ]),
      ),
    );
    expect(results[0]?.status).toBe('rejected');
    expect(useCoreAssetsStore().fields.status).toBe('error');
    expect(useCoreAssetsStore().graphics.content).toEqual(['graphics/review.png']);
    expect(mocks.fields).toHaveBeenCalledTimes(2);
    expect(mocks.graphics).toHaveBeenCalledTimes(2);
  });
  it('subscribes and releases the actual window root and accepts changes without Mod sessions', async () => {
    await loadCoreGraphics();
    await flushPromises();
    expect(mocks.setSource).toHaveBeenLastCalledWith('D:/A');
    mocks.graphics.mockResolvedValueOnce(['graphics/replaced.png']);
    for (const receive of mocks.coreChanged) await receive('D:/A', [{ source: 'core', relPath: 'graphics/replaced.png' }]);
    expect(useCoreAssetsStore().graphics.content).toEqual(['graphics/replaced.png']);
    root.value = 'D:/B';
    await flushPromises();
    expect(mocks.setSource).toHaveBeenLastCalledWith('D:/B');
    stop();
    await flushPromises();
    expect(mocks.setSource).toHaveBeenLastCalledWith(null);
    expect(mocks.coreChanged.size).toBe(0);
  });
  it('releases a second loader when its operation fails and ignores subsequent changes', async () => {
    setActivePinia(createPinia());
    const releasedRoot = ref<string | null>('D:/released');
    const stopReleased = startCoreAssetsLoading(releasedRoot);
    onTestFinished(stopReleased);
    await Promise.all([loadCoreFields(), loadCoreGraphics()]);
    expect(mocks.fields).toHaveBeenCalledExactlyOnceWith('D:/released');
    expect(mocks.graphics).toHaveBeenCalledExactlyOnceWith('D:/released');
    mocks.fields.mockClear();
    mocks.graphics.mockClear();
    const failure = new Error('fixture operation failed');
    await expect(
      (async () => {
        try {
          throw failure;
        } finally {
          stopReleased();
        }
      })(),
    ).rejects.toBe(failure);
    releasedRoot.value = 'D:/later';
    await flushPromises();
    expect(mocks.fields).toHaveBeenCalledTimes(0);
    expect(mocks.graphics).toHaveBeenCalledTimes(0);
  });
  it.each([false, true])('clears and reloads an unused Core root with a changed lifetime=%s', async (changed) => {
    await Promise.all([loadCoreFields(), loadCoreGraphics()]);
    let finish!: () => void;
    mocks.clear.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = refreshCoreAssets('D:/A');
    onTestFinished(async () => {
      finish();
      await pending;
    });
    if (changed) {
      root.value = 'D:/B';
      root.value = 'D:/A';
    }
    await flushPromises();
    const calls = mocks.fields.mock.calls.length;
    finish();
    await pending;
    expect(mocks.clear).toHaveBeenCalledExactlyOnceWith('D:/A');
    expect(mocks.fields).toHaveBeenCalledTimes(calls + Number(!changed));
    expect(mocks.graphics).toHaveBeenCalledTimes(calls + Number(!changed));
  });
  async function refresh(path: string, source: 'core' | 'mod' = 'core', gameRoot = 'd:/a') {
    const update = sessionUpdateFixture('s', 'M:/mod').content;
    update.manifest.starsectorRoot = gameRoot;
    update.invalidation.resources = [{ source, relPath: path }];
    await dispatchProjectChangeFixture({ kind: 'refresh', content: update });
    await flushPromises();
  }

  it.each([
    ['data/hulls/demo.ship', 2, 1],
    ['data/world/factions/demo.faction', 2, 1],
    ['data/weapons/demo.wpn', 2, 1],
    ['data/shipsystems/wpn/demo.wpn', 2, 1],
    ['graphics/ships/demo.png', 1, 2],
    ['graphics-backup/demo.png', 1, 1],
    ['data', 2, 1],
  ])('refreshes the affected product for %s', async (path, fieldCalls, graphicsCalls) => {
    await Promise.all([loadCoreFields(), loadCoreGraphics()]);
    await refresh(path);
    expect(mocks.fields).toHaveBeenCalledTimes(fieldCalls);
    expect(mocks.graphics).toHaveBeenCalledTimes(graphicsCalls);
  });

  it('keeps loaded Core products through Mod and other-root refreshes', async () => {
    await Promise.all([loadCoreFields(), loadCoreGraphics()]);
    await refresh('data/hulls/demo.ship', 'mod');
    await refresh('graphics/demo.png', 'core', 'D:/B');
    expect(mocks.fields).toHaveBeenCalledTimes(1);
    expect(mocks.graphics).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)('revokes the prior same-root request on refresh: %s', async (completion) => {
    let resolve!: (value: typeof fields) => void;
    let reject!: (error: Error) => void;
    mocks.fields.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const old = loadCoreFields();
    onTestFinished(async () => {
      resolve(fields);
      await old;
    });
    await refresh('data/hulls/demo.ship');
    if (completion === 'resolve') resolve({});
    else reject(new Error('stale'));
    await old;
    expect(useCoreAssetsStore().fields).toMatchObject({ content: fields, status: 'ready' });
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('retains content on refresh failure and retries the current product', async () => {
    await loadCoreGraphics();
    mocks.graphics.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(refresh('graphics/demo.png')).rejects.toThrow('refresh failed');
    expect(useCoreAssetsStore().graphics).toMatchObject({ content: ['graphics/a.png'], status: 'error' });
    mocks.graphics.mockResolvedValueOnce(['graphics/b.png']);
    await loadCoreGraphics();
    expect(useCoreAssetsStore().graphics).toMatchObject({ content: ['graphics/b.png'], status: 'ready' });
  });

  it('releases the refresh subscription and ignores queued events after disposal', async () => {
    stop();
    await refresh('graphics/demo.png');
    expect(projectChangeListeners.size).toBe(0);
    expect(mocks.graphics).not.toHaveBeenCalled();
  });

  it('updates both window stores from the same explicit refresh event', async () => {
    const first = useCoreAssetsStore();
    await loadCoreGraphics();
    setActivePinia(createPinia());
    const stopSecond = startCoreAssetsLoading(ref('D:/A'));
    onTestFinished(stopSecond);
    const second = useCoreAssetsStore();
    await loadCoreGraphics();
    mocks.graphics.mockResolvedValue(['graphics/new.png']);
    await refresh('graphics');
    expect(first.graphics.content).toEqual(['graphics/new.png']);
    expect(second.graphics.content).toEqual(['graphics/new.png']);
    expect(mocks.graphics).toHaveBeenCalledTimes(4);
  });
  it('registers the root without reading until a consumer requests each resource', async () => {
    expect(useCoreAssetsStore().root).toBe('D:/A');
    expect(mocks.fields).not.toHaveBeenCalled();
    expect(mocks.graphics).not.toHaveBeenCalled();
    await loadCoreFields();
    expect(mocks.fields).toHaveBeenCalledExactlyOnceWith('D:/A');
    expect(mocks.graphics).not.toHaveBeenCalled();
  });
  it('isolates loaders, responses and release between window stores', async () => {
    const first = useCoreAssetsStore();
    const firstPending = loadCoreFields();
    const secondPinia = createPinia();
    setActivePinia(secondPinia);
    const secondRoot = ref<string | null>('D:/second');
    const secondScope = effectScope();
    const stopSecond = secondScope.run(() => startCoreAssetsLoading(secondRoot))!;
    onTestFinished(() => {
      stopSecond();
      secondScope.stop();
    });
    const second = useCoreAssetsStore();
    await loadCoreGraphics();
    await firstPending;
    expect(first.fields.status).toBe('ready');
    expect(second.fields.status).toBe('idle');
    expect(second.graphics.status).toBe('ready');
    stop();
    expect(first.root).toBeNull();
    expect(second.root).toBe('D:/second');
  });
  it('projects loaded fields and graphics through reactive facades', async () => {
    const schema = useCoreSchema();
    const graphics = useCoreGraphics();
    await Promise.all([schema.loadCoreFields(), graphics.loadGraphics()]);
    expect(schema.loaded.value).toBe(true);
    expect(graphics.graphicsPaths.value).toEqual(['graphics/a.png']);
    expect(useCoreAssetsStore().fields.content).toEqual(fields);
    expect(
      schema
        .getMergedSchema('faction')
        ?.sections?.flatMap((section) => section.fields)
        .some((field) => field.key === 'file.bonus'),
    ).toBe(false);
    expect(schema.getMergedSchema('unknown')).toBeNull();
  });

  it('shares the pending promise and waits for its result', async () => {
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const first = loadCoreFields();
    const second = loadCoreFields();
    onTestFinished(async () => {
      resolve(fields);
      await second;
    });
    await flushPromises();
    expect(second).toBe(first);
    expect(mocks.fields).toHaveBeenCalledTimes(1);
    resolve(fields);
    await second;
    expect(useCoreAssetsStore().fields.status).toBe('ready');
  });

  it('clears old projections immediately and loads a new root independently', async () => {
    await loadCoreFields();
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    root.value = 'D:/B';
    const current = loadCoreFields();
    onTestFinished(async () => {
      resolve(fields);
      await current;
    });
    expect(useCoreAssetsStore().fields.content).toEqual({});
    expect(useCoreAssetsStore().fields.status).toBe('loading');
    await loadCoreGraphics();
    expect(useCoreAssetsStore().graphics.status).toBe('ready');
    resolve(fields);
    await loadCoreFields();
  });

  it.each(['resolve', 'reject'] as const)('releases a stale A response on A-B-A: %s', async (completion) => {
    let resolve!: (content: typeof fields) => void;
    let reject!: (error: Error) => void;
    mocks.fields.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const old = loadCoreFields();
    onTestFinished(async () => {
      resolve(fields);
      await old;
    });
    root.value = 'D:/B';
    root.value = 'D:/A';
    await loadCoreFields();
    if (completion === 'resolve') resolve({});
    else reject(new Error('stale'));
    await old;
    expect(useCoreAssetsStore().fields.content).toEqual(fields);
    expect(useCoreAssetsStore().fields.status).toBe('ready');
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('logs a failure once and retries through the current read entry', async () => {
    mocks.fields.mockRejectedValueOnce({ code: 'parse.json', message: 'raw detail', location: null });
    await Promise.all([loadCoreFields(), loadCoreFields(), loadCoreGraphics()]);
    expect(useCoreAssetsStore().fields.status).toBe('error');
    expect(useCoreAssetsStore().graphics.status).toBe('ready');
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'parse.json', message: 'raw detail' }));
    await loadCoreFields();
    expect(useCoreAssetsStore().fields.status).toBe('ready');
  });

  it.each(['clear', 'dispose'] as const)('revokes pending response on %s', async (action) => {
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const pending = loadCoreFields();
    onTestFinished(async () => {
      resolve(fields);
      await pending;
    });
    await flushPromises();
    if (action === 'clear') root.value = null;
    else stop();
    resolve(fields);
    await pending;
    expect(useCoreAssetsStore().root).toBeNull();
    expect(useCoreAssetsStore().fields).toMatchObject({ content: {}, status: 'idle' });
  });
});
