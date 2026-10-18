import { createPinia, setActivePinia } from 'pinia';
import { effectScope, ref, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCoreAssetsLoading, loadCoreFields, loadCoreGraphics } from '@/orchestrators/core-assets.orchestrator';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { useCoreGraphics } from './use-core-assets';
import { useCoreSchema } from './use-core-schema';
import type { DiscoveredField } from '@/shared/types';

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
    expect(schema.getMergedSchema('faction')?.sections?.at(-1)?.id).toBe('__core_discovered');
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
