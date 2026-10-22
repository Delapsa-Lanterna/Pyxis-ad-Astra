import { invoke } from '@tauri-apps/api/core';
import { AppError, errorMessageOf } from '@/shared/lib/errors';
import { beginPerformance, performanceMonitorEnabled } from './performance';

let sequence = 0;
let instance = '';

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const request =
    performanceMonitorEnabled && !command.startsWith('performance_monitor_') ? `${(instance ||= crypto.randomUUID())}:${++sequence}` : null;
  const finish = request ? beginPerformance('ipc', command, { request }) : null;
  try {
    const value = await (request ? invoke<T>(command, args, { headers: { 'x-performance-request': request } }) : invoke<T>(command, args));
    finish?.();
    return value;
  } catch (cause) {
    finish?.('error');
    throw new AppError(errorMessageOf(cause), { command, cause });
  }
}
