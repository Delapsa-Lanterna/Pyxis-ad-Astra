import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeCommand } from './command.runtime';
import { AppError, errorContextOf, errorDiagnosticOf, formatError, withCause } from '@/shared/lib/errors';
import { appLogQueue } from './app-log-queue';
import { logIdentity } from '@/shared/lib/log-fields';
import type { AppLogEntry } from '@/shared/types';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
beforeEach(() => vi.clearAllMocks());

describe('command transport', () => {
  it('projects target counts while leaving bodies and unrelated getters untouched', () => {
    const body = vi.fn(() => 'private content');
    const value = {
      payload: {
        sessionId: 's',
        input: 'private input',
        targets: [
          { kind: 'weapon', id: 'one' },
          { kind: 'ship', id: 'two' },
        ],
        get text() {
          return body();
        },
      },
    };
    expect(logIdentity(value)).toMatchObject({
      'payload.sessionId': 's',
      'payload.targets.count': '2',
    });
    expect(body).not.toHaveBeenCalled();
    expect(logIdentity(value)).not.toHaveProperty('payload.input');
  });

  it('automatically correlates success and failure and excludes log and monitor calls', async () => {
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (entries) => {
      records.push(...entries);
    }, vi.fn());
    appLogQueue.setLevel('debug');
    try {
      mockInvoke.mockResolvedValue({ secret: 'response' });
      await invokeCommand('new_command', { secret: 'request' });
      mockInvoke.mockRejectedValueOnce(new Error('private failure'));
      await expect(invokeCommand('failed_command')).rejects.toThrow();
      await invokeCommand('get_app_log_status');
      await invokeCommand('append_app_logs');
      await invokeCommand('stop_app_log');
      await invokeCommand('performance_monitor_batch');
      await appLogQueue.flush();
      expect(records.map((entry) => entry.code)).toEqual(['command.started', 'command.completed', 'command.started', 'command.failed']);
      expect(records[0]!.fields?.request).toBe(records[1]!.fields?.request);
      expect(records[2]!.fields?.request).not.toBe(records[0]!.fields?.request);
      expect(JSON.stringify(records)).not.toContain('secret');
      expect(records[3]!.fields?.errorMessage).toBe('private failure');
    } finally {
      appLogQueue.setLevel('info');
    }
  });
  it('preserves arguments and the successful result', async () => {
    const result = { target: 'loaded' };
    const args = { payload: { sessionId: null }, title: 'Demo' };
    mockInvoke.mockResolvedValue(result);
    expect(await invokeCommand('read_demo', args)).toBe(result);
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('read_demo', args);
  });

  it('invokes a command without arguments', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await invokeCommand('release_demo');
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('release_demo', undefined);
  });

  it('keeps diagnostics, source payload and separate action context', async () => {
    const cause = {
      code: 'parse.json_syntax',
      message: 'Raw detail',
      location: { path: 'demo.json', line: 3, column: 7 },
      files: ['demo'],
    };
    mockInvoke.mockRejectedValue(cause);
    const error = await invokeCommand('save_demo', { id: 'captured-id' }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ command: 'save_demo', cause });
    expect(errorDiagnosticOf(error)).toEqual({ code: cause.code, message: cause.message, location: cause.location });
    expect(formatError(error)).toBe('JSON 语法错误');
    const wrapped = withCause('保存失败', error, 'save-demo');
    expect(formatError(wrapped)).toBe('保存失败：JSON 语法错误');
    expect(errorContextOf(wrapped)).toEqual({ action: 'save-demo', command: 'save_demo', id: 'captured-id' });
  });
});
