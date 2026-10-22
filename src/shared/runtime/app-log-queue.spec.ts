import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLogQueue, beginDebug, debugLog, createAppLogQueue } from './app-log-queue';
import type { AppLogEntry, AppLogLevel } from '@/shared/types';

const entry = (level: AppLogLevel): AppLogEntry => ({ level, code: 'fixture', message: null, path: null, line: null, fields: null });
afterEach(() => vi.useRealTimers());

describe('log queue', () => {
  it('filters detailed fields and interval clocks before evaluating them', async () => {
    appLogQueue.setLevel('info');
    const fields = vi.fn(() => ({ field: 'fixture' }));
    const clock = vi.spyOn(performance, 'now');
    debugLog('fixture', fields);
    expect(beginDebug('fixture', fields)).toBeUndefined();
    expect(fields).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
    await appLogQueue.flush();
  });
  it.each([
    ['debug', 4],
    ['info', 3],
    ['warning', 2],
    ['error', 1],
  ] as const)('filters %s at the producer', async (level, count) => {
    const queue = createAppLogQueue(),
      deliver = vi.fn<(entries: AppLogEntry[]) => Promise<void>>(async () => {});
    queue.install(deliver, vi.fn());
    queue.setLevel(level);
    for (const value of ['debug', 'info', 'warning', 'error'] as const) queue.record(entry(value));
    await queue.flush();
    expect(deliver.mock.calls[0]![0]).toHaveLength(count);
  });
  it('drains every record through one in-flight batch and includes records added during a write', async () => {
    const queue = createAppLogQueue();
    let release!: () => void;
    const batches: AppLogEntry[][] = [];
    queue.install(async (records) => {
      batches.push(records);
      if (batches.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    }, vi.fn());
    for (let index = 0; index < 200; index++) queue.record(entry('info'));
    const flush = queue.flush();
    expect(batches).toHaveLength(1);
    expect(queue.flush()).toBe(flush);
    queue.record(entry('error'));
    release();
    await flush;
    expect(batches.map((batch) => batch.length)).toEqual([64, 64, 64, 9]);
    expect(queue.status()).toMatchObject({ pending: 0, dropped: 0 });
  });
  it('sends a small batch after 100 ms and closes without another scheduled write', async () => {
    vi.useFakeTimers();
    const queue = createAppLogQueue(),
      deliver = vi.fn(async () => {});
    queue.install(deliver, vi.fn());
    queue.record(entry('info'));
    await vi.advanceTimersByTimeAsync(99);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenCalledOnce();
    queue.record(entry('info'));
    await queue.flush();
    await vi.runAllTimersAsync();
    expect(deliver).toHaveBeenCalledTimes(2);
  });
  it('releases all records once on failure and resumes only in a fresh runtime', async () => {
    const queue = createAppLogQueue(),
      failed = vi.fn();
    let reject!: (error: Error) => void;
    queue.install(
      () =>
        new Promise<void>((_, no) => {
          reject = no;
        }),
      failed,
    );
    for (let index = 0; index < 90; index++) queue.record(entry('info'));
    const flush = queue.flush();
    reject(new Error('disk full'));
    await flush;
    queue.stop('second failure');
    queue.setLevel('debug');
    queue.record(entry('error'));
    await queue.flush();
    expect(failed).toHaveBeenCalledExactlyOnceWith('disk full', 90);
    expect(queue.status()).toMatchObject({ pending: 0, dropped: 90, error: 'disk full' });
    expect(createAppLogQueue().enabled('error')).toBe(true);
  });
  it('changes filtering only for future records', async () => {
    const queue = createAppLogQueue(),
      batches: AppLogEntry[][] = [];
    queue.install(async (records) => {
      batches.push(records);
    }, vi.fn());
    queue.record(entry('info'));
    queue.setLevel('error');
    queue.record(entry('info'));
    queue.record(entry('error'));
    await queue.flush();
    expect(batches[0]!.map((record) => record.level)).toEqual(['info', 'error']);
  });
});
