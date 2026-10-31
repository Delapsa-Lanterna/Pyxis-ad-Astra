import { createApp } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createPinia, defineStore } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppLogEntry } from '@/shared/types';

const api = vi.hoisted(() => ({ load: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock('@/services/app-log.service', () => ({ loadLogStatus: api.load, listenLogStopped: api.listen }));
let records: AppLogEntry[];
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  records = [];
  api.load.mockResolvedValue({ lastError: null });
  api.listen.mockResolvedValue(api.stop);
  const { appLogQueue } = await import('@/shared/runtime/app-log-queue');
  appLogQueue.install(async (entries) => {
    records.push(...entries);
  }, vi.fn());
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));

async function boot() {
  const { startApplicationLog } = await import('./application-log');
  const pinia = createPinia();
  await startApplicationLog(pinia);
  createApp({ render: () => null }).use(pinia);
  return { pinia, queue: (await import('@/shared/runtime/app-log-queue')).appLogQueue };
}

describe('automatic action logging', () => {
  it('follows level changes on existing stores and records sync, async and failed outcomes without argument values', async () => {
    const { pinia, queue } = await boot();
    const store = defineStore('fixture', {
      actions: {
        sync(value: string) {
          return value;
        },
        async wait() {
          return 7;
        },
        fail() {
          throw new Error('secret diagnostic');
        },
        async failAsync() {
          throw new Error('async secret');
        },
      },
    })(pinia);
    store.sync('private');
    expect(records).toEqual([]);
    queue.setLevel('debug');
    expect(store.sync('private')).toBe('private');
    expect(await store.wait()).toBe(7);
    expect(() => store.fail()).toThrow('secret diagnostic');
    await expect(store.failAsync()).rejects.toThrow('async secret');
    await queue.flush();
    expect(records.map((entry) => entry.code)).toEqual([
      'store.action.started',
      'store.action.completed',
      'store.action.started',
      'store.action.completed',
      'store.action.started',
      'store.action.failed',
      'store.action.started',
      'store.action.failed',
    ]);
    expect(JSON.stringify(records)).not.toContain('private');
    expect(records[0]!.fields?.request).toBe(records[1]!.fields?.request);
    expect(records[0]!.fields?.request).not.toBe(records[2]!.fields?.request);
    expect(JSON.stringify(records)).not.toContain('secret diagnostic');
    queue.setLevel('info');
    store.sync('hidden');
    await queue.flush();
    expect(records).toHaveLength(8);
  });
  it('stops on the process-wide event and releases its listener on page hide', async () => {
    const { queue } = await boot();
    queue.record({ level: 'info', code: 'pending', message: null, path: null, line: null, fields: null });
    const handler = api.listen.mock.calls[0]![0];
    await handler('disk full');
    expect(queue.status()).toMatchObject({ error: 'disk full', dropped: 1, pending: 0 });
    window.dispatchEvent(new Event('pagehide'));
    expect(api.stop).toHaveBeenCalledOnce();
  });
  it('waits for an accepted in-flight batch before counting queued losses', async () => {
    const { queue } = await boot();
    let finish!: () => void;
    queue.install(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      vi.fn(),
    );
    for (let index = 0; index < 66; index++)
      queue.record({ level: 'info', code: null, message: null, path: null, line: null, fields: null });
    const completing = queue.flush();
    await api.listen.mock.calls[0]![0]('other window failed');
    finish();
    await completing;
    expect(queue.status()).toMatchObject({ error: 'other window failed', dropped: 2, pending: 0 });
  });
  it('keeps startup available when reading logging status fails', async () => {
    api.load.mockRejectedValue(new Error('status failed'));
    const { queue } = await boot();
    expect(queue.status().error).toBe('status failed');
  });
  it.each(['registration', 'status'] as const)('releases during %s waiting and ignores late results', async (stage) => {
    const { startApplicationLog } = await import('./application-log');
    const { appLogQueue, applicationLogError } = await import('@/shared/runtime/app-log-queue');
    let finish!: (value: unknown) => void;
    api[stage === 'registration' ? 'listen' : 'load'].mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pinia = createPinia(),
      install = vi.spyOn(pinia, 'use');
    const pending = startApplicationLog(pinia);
    await flushPromises();
    window.dispatchEvent(new Event('pagehide'));
    finish(stage === 'registration' ? api.stop : { lastError: 'late fixture' });
    await pending;
    api.listen.mock.calls[0]![0]('late notification');
    expect(api.stop).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(applicationLogError.value).toBe('');
    expect(appLogQueue.status().error).toBe('');
    if (stage === 'registration') expect(api.load).not.toHaveBeenCalled();
  });
  it.each(['registration', 'status'] as const)('keeps a late %s failure out of the released owner', async (stage) => {
    const { startApplicationLog } = await import('./application-log');
    const { applicationLogError } = await import('@/shared/runtime/app-log-queue');
    let fail!: (error: Error) => void;
    api[stage === 'registration' ? 'listen' : 'load'].mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const pending = startApplicationLog(createPinia());
    const settled = pending.catch((error: unknown) => error);
    await flushPromises();
    window.dispatchEvent(new Event('pagehide'));
    fail(new Error('late fixture'));
    await settled;
    expect(applicationLogError.value).toBe('');
    expect(api.stop).toHaveBeenCalledTimes(stage === 'status' ? 1 : 0);
  });
});
