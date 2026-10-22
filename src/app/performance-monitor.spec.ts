import { createApp } from 'vue';
import { createPinia, defineStore } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  controlPerformanceMonitor,
  flushPerformanceMonitor,
  performanceMonitorError,
  startPerformanceMonitor,
} from './performance-monitor';
import { performanceMonitorEnabled, recordPerformance } from '@/shared/runtime/performance';
import type { PerformanceBatch } from '@/shared/types/performance-monitor.types';

const api = vi.hoisted(() => ({ deliver: vi.fn(), report: vi.fn() }));
vi.mock('@/services/performance-monitor.service', () => ({ deliverPerformanceBatch: api.deliver, performanceMonitorReport: api.report }));
let callback: PerformanceObserverCallback;
const observe = vi.fn(),
  disconnect = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.deliver.mockResolvedValue(undefined);
  api.report.mockResolvedValue({ enabled: true });
  performanceMonitorError.value = '';
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes = ['event', 'longtask'];
      constructor(ready: PerformanceObserverCallback) {
        callback = ready;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function boot(enabled = true) {
  const pinia = createPinia();
  startPerformanceMonitor(pinia, enabled);
  const app = createApp({ render: () => null }).use(pinia);
  return { pinia, app };
}
describe('window performance collection', () => {
  it('installs zero observers, timers or recording hooks while disabled', () => {
    const { app } = boot(false);
    expect(performanceMonitorEnabled).toBe(false);
    expect(observe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(flushPerformanceMonitor()).toBeUndefined();
    recordPerformance('none', 2);
    expect(api.deliver).not.toHaveBeenCalled();
    app.unmount();
  });
  it('automatically records synchronous, asynchronous and failing actions', async () => {
    const { pinia } = boot();
    const store = defineStore('automatic', {
      actions: {
        sync() {
          return 4;
        },
        async asyncAction() {
          return 5;
        },
        failure() {
          throw new Error('fixture');
        },
        async asyncFailure() {
          throw new Error('async fixture');
        },
      },
    })(pinia);
    expect(store.sync()).toBe(4);
    expect(await store.asyncAction()).toBe(5);
    expect(() => store.failure()).toThrow('fixture');
    await expect(store.asyncFailure()).rejects.toThrow('async fixture');
    await flushPerformanceMonitor();
    const batch: PerformanceBatch = api.deliver.mock.calls[0]![0];
    expect(batch.samples.map((sample) => [sample.name, sample.fields.status])).toEqual([
      ['automatic.sync', 'ok'],
      ['automatic.asyncAction', 'ok'],
      ['automatic.failure', 'error'],
      ['automatic.asyncFailure', 'error'],
    ]);
    window.dispatchEvent(new Event('pagehide'));
    const clock = vi.spyOn(performance, 'now');
    store.sync();
    defineStore('after-release', { actions: { sync: () => 1 } })(pinia).sync();
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });
  it('bounds pending samples, batches at 512 and reports overwritten records', async () => {
    boot();
    for (let index = 0; index < 2050; index++) recordPerformance(`sample-${index}`, 0.25);
    await vi.advanceTimersByTimeAsync(1000);
    const batches = api.deliver.mock.calls.map(([batch]) => batch as PerformanceBatch);
    expect(batches.map((batch) => batch.samples.length)).toEqual([512, 512, 512, 512]);
    expect(batches.reduce((sum, batch) => sum + batch.overwritten, 0)).toBe(2);
    expect(batches[0]!.samples[0]!.name).toBe('sample-2');
  });
  it('serializes delivery, preserves failed samples and clears the error after retry', async () => {
    boot();
    recordPerformance('retained', 1);
    api.deliver.mockRejectedValueOnce(new Error('delivery failed'));
    await expect(flushPerformanceMonitor()).rejects.toThrow('delivery failed');
    expect(performanceMonitorError.value).toContain('delivery failed');
    let done!: () => void;
    api.deliver.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    const first = flushPerformanceMonitor(),
      second = flushPerformanceMonitor();
    expect(first).toBe(second);
    recordPerformance('during-delivery', 2);
    done();
    await first;
    expect(api.deliver.mock.calls[1]![0].samples[0].name).toBe('retained');
    expect(api.deliver.mock.calls[2]![0].samples[0].name).toBe('during-delivery');
    expect(performanceMonitorError.value).toBe('');
  });
  it('flushes local observations before control operations and releases on pagehide', async () => {
    boot();
    callback(
      { getEntries: () => [{ name: 'click', entryType: 'event', startTime: 3, duration: 16 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    await controlPerformanceMonitor('export');
    expect(api.deliver.mock.invocationCallOrder[0]).toBeLessThan(api.report.mock.invocationCallOrder[0]!);
    expect(api.deliver.mock.calls[0]![0].samples[0].category).toBe('event');
    window.dispatchEvent(new Event('pagehide'));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(performanceMonitorEnabled).toBe(false);
  });
});
