import type { AppLogEntry, AppLogStatus, AppendAppLogsPayload } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { appLogQueue, applicationLogError } from '@/shared/runtime/app-log-queue';
import { errorMessageOf } from '@/shared/lib/errors';

appLogQueue.install(
  async (entries) => {
    await invokeCommand('append_app_logs', { payload: { entries } satisfies AppendAppLogsPayload });
  },
  (message, dropped) => {
    applicationLogError.value = message;
    void invokeCommand('stop_app_log', { message, dropped }).catch((cause) => {
      applicationLogError.value = `${message}; ${errorMessageOf(cause)}`;
    });
  },
);

export function recordLogBestEffort(entry: AppLogEntry): void {
  appLogQueue.record(entry);
}
export const flushApplicationLogs = appLogQueue.flush;

export async function loadLogStatus(): Promise<AppLogStatus> {
  const status = await invokeCommand<AppLogStatus>('get_app_log_status');
  if (status.lastError) appLogQueue.stop(status.lastError);
  return { ...status, pending: status.pending + appLogQueue.status().pending };
}

export async function openLogFile(): Promise<void> {
  await flushApplicationLogs();
  return invokeCommand('open_app_log_file');
}

export async function clearLog(): Promise<AppLogStatus> {
  await flushApplicationLogs();
  return invokeCommand('clear_app_log_file');
}
