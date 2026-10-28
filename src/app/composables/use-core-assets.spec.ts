vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({ ...(await import('@/test/unit/project-changes')) }));
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, ref, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCoreAssetsLoading, loadCoreFields, loadCoreGraphics } from '@/orchestrators/core-assets.orchestrator';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { useCoreGraphics } from './use-core-assets';
import { useCoreSchema } from './use-core-schema';
import type { DiscoveredField } from '@/shared/types';
import { dispatchProjectChangeFixture, projectChangeListeners } from '@/test/unit/project-changes';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({ fields: vi.fn(), graphics: vi.fn(), log: vi.fn() }));
vi.mock('@/services/core-assets.service', () => ({ queryCoreFields: mocks.fields, queryCoreGraphics: mocks.graphics }));
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
  async function refresh(path: string, source: 'core' | 'mod' = 'core', gameRoot = 'd:/a') {
    const projection = sessionUpdateFixture('s', 'M:/mod').projection;
    projection.manifest.starsectorRoot = gameRoot;
    projection.invalidation.resources = [{ source, relPath: path }];
    await dispatchProjectChangeFixture({ kind: 'refresh', projection });
    await flushPromises();
  }

  it.each([
    ['data/hulls/demo.ship', 2, 1],
    ['data/world/factions/demo.faction', 2, 1],
    ['data/weapons/demo.wpn', 2, 1],
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
    const second = useCoreAssetsStore();
    await loadCoreGraphics();
    mocks.graphics.mockResolvedValue(['graphics/new.png']);
    await refresh('graphics');
    expect(first.graphics.content).toEqual(['graphics/new.png']);
    expect(second.graphics.content).toEqual(['graphics/new.png']);
    expect(mocks.graphics).toHaveBeenCalledTimes(4);
    stopSecond();
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
    const second = useCoreAssetsStore();
    await loadCoreGraphics();
    await firstPending;
    expect(first.fields.status).toBe('ready');
    expect(second.fields.status).toBe('idle');
    expect(second.graphics.status).toBe('ready');
    stop();
    expect(first.root).toBeNull();
    expect(second.root).toBe('D:/second');
    stopSecond();
    secondScope.stop();
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
    if (action === 'clear') root.value = null;
    else stop();
    resolve(fields);
    await pending;
    expect(useCoreAssetsStore().root).toBeNull();
    expect(useCoreAssetsStore().fields).toMatchObject({ content: {}, status: 'idle' });
  });
});
