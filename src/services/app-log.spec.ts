import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const status = { path: 'C:/fixture/app.log', sizeBytes: 0, recording: 'active', level: 'info', lastError: null, dropped: 0, pending: 0 };
const entry = { level: 'warning' as const, code: 'demo', message: 'raw', path: null, line: null, fields: null };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  invoke.mockResolvedValue(status);
});

describe('application log lifecycle', () => {
  it('batches records with event time and stable window sequence', async () => {
    const service = await import('./app-log.service');
    for (let index = 0; index < 10; index++) service.recordLogBestEffort(entry);
    expect(invoke).not.toHaveBeenCalled();
    await service.flushApplicationLogs();
    expect(invoke).toHaveBeenCalledOnce();
    const [command, args] = invoke.mock.calls[0]!;
    expect(command).toBe('append_app_logs');
    expect(args.payload.entries).toHaveLength(10);
    expect(args.payload.entries[0]).toMatchObject({
      ...entry,
      fields: { timestamp: expect.any(String), window: expect.any(String), sequence: '1' },
    });
    expect(args.payload.entries[9].fields.window).toBe(args.payload.entries[0].fields.window);
    expect(args.payload.entries[9].fields.sequence).toBe('10');
  });

  it('stops the run after a failure, reports all queued records and keeps business results', async () => {
    const service = await import('./app-log.service');
    const { appLogQueue } = await import('@/shared/runtime/app-log-queue');
    invoke.mockRejectedValueOnce(new Error('disk full'));
    service.recordLogBestEffort(entry);
    service.recordLogBestEffort(entry);
    await expect(service.flushApplicationLogs()).resolves.toBeUndefined();
    expect(appLogQueue.status()).toMatchObject({ dropped: 2, pending: 0, error: 'disk full' });
    expect(invoke).toHaveBeenLastCalledWith('stop_app_log', { message: 'disk full', dropped: 2 });
    appLogQueue.setLevel('debug');
    service.recordLogBestEffort(entry);
    await service.flushApplicationLogs();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each(['openLogFile', 'clearLog'] as const)('flushes before %s', async (action) => {
    const service = await import('./app-log.service');
    service.recordLogBestEffort(entry);
    await service[action]();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'append_app_logs',
      action === 'clearLog' ? 'clear_app_log_file' : 'open_app_log_file',
    ]);
  });

  it('accepts a stopped process and reports local pending state', async () => {
    const service = await import('./app-log.service');
    invoke.mockResolvedValue({ ...status, recording: 'stopped', dropped: 3, lastError: 'write failed' });
    expect(await service.loadLogStatus()).toMatchObject({ recording: 'stopped', dropped: 3, pending: 0 });
    service.recordLogBestEffort(entry);
    await service.flushApplicationLogs();
    expect(invoke.mock.calls.filter(([command]) => command === 'append_app_logs')).toHaveLength(0);
  });
});
