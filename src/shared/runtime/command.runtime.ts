import { invoke } from '@tauri-apps/api/core';
import { AppError, errorMessageOf } from '@/shared/lib/errors';
import { beginPerformance, performanceMonitorEnabled } from './performance';
import { appLogQueue, beginDebug, shouldQueueLog } from './app-log-queue';

let sequence = 0;
let instance = '';

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const observable = !command.startsWith('performance_monitor_') && !command.includes('app_log');
  const request =
    (performanceMonitorEnabled || shouldQueueLog('debug')) && observable ? `${(instance ||= crypto.randomUUID())}:${++sequence}` : null;
  const finish = request && performanceMonitorEnabled ? beginPerformance('ipc', command, { request }) : null;
  const log = request ? beginDebug('command', () => ({ command, request })) : undefined;
  try {
    const value = await (request && performanceMonitorEnabled
      ? invoke<T>(command, args, { headers: { 'x-performance-request': request } })
      : invoke<T>(command, args));
    finish?.();
    log?.();
    if (command === 'ready_close' || command === 'reply_close') await appLogQueue.flush();
    return value;
  } catch (cause) {
    finish?.('error');
    log?.('failed');
    throw new AppError(errorMessageOf(cause), { command, cause });
  }
}
