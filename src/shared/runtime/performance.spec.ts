import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeCommand } from './command.runtime';
import { beginPerformance, installPerformanceMonitor, recordPerformance, startPerformance, type PerformanceSample } from './performance';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
  invoke.mockReset();
});

describe('automatic performance transport', () => {
  it('keeps disabled transport arguments and performs zero clock reads', async () => {
    const clock = vi.spyOn(performance, 'now');
    invoke.mockResolvedValue('value');
    expect(startPerformance()).toBe(0);
    recordPerformance('ignored', 2);
    expect(await invokeCommand('new_command', { value: null })).toBe('value');
    expect(clock).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('new_command', { value: null });
  });
  it('automatically observes new commands and correlates concurrent outcomes', async () => {
    const records: PerformanceSample[] = [];
    stop = installPerformanceMonitor((sample) => records.push(sample));
    let resolve!: (value: string) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<string>((ready) => {
          resolve = ready;
        }),
    );
    const first = invokeCommand('first_new_command');
    const error = { message: 'failed', code: 'fixture.failure' };
    invoke.mockRejectedValueOnce(error);
    await expect(invokeCommand('second_new_command')).rejects.toMatchObject({ command: 'second_new_command', cause: error });
    resolve('accepted');
    expect(await first).toBe('accepted');
    expect(records.map((record) => [record.name, record.fields.status])).toEqual([
      ['second_new_command', 'error'],
      ['first_new_command', 'ok'],
    ]);
    expect(new Set(records.map((record) => record.fields.request)).size).toBe(2);
    for (const [command, , options] of invoke.mock.calls) {
      expect(records.find((record) => record.name === command)?.fields.request).toBe(options.headers['x-performance-request']);
    }
  });
  it('excludes monitor control operations and preserves sub-millisecond durations', async () => {
    const records: PerformanceSample[] = [];
    stop = installPerformanceMonitor((sample) => records.push(sample));
    invoke.mockResolvedValue(undefined);
    await invokeCommand('performance_monitor_batch', { batch: {} });
    expect(records).toEqual([]);
    vi.spyOn(performance, 'now').mockReturnValueOnce(1).mockReturnValueOnce(1.125);
    beginPerformance('action', 'sample')();
    expect(records[0]!.duration).toBe(0.125);
    expect(invoke.mock.calls[0]).toEqual(['performance_monitor_batch', { batch: {} }]);
  });
  it('keeps in-flight intervals attached to their collector lifetime', () => {
    const first: PerformanceSample[] = [],
      second: PerformanceSample[] = [];
    const release = installPerformanceMonitor((sample) => first.push(sample));
    const finish = beginPerformance('query', 'released');
    release();
    stop = installPerformanceMonitor((sample) => second.push(sample));
    release();
    const clock = vi.spyOn(performance, 'now');
    finish();
    expect(clock).not.toHaveBeenCalled();
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    beginPerformance('query', 'current')();
    expect(second.map((sample) => sample.name)).toEqual(['current']);
  });
});
