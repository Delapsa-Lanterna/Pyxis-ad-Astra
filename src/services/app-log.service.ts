import type { AppendAppLogPayload, AppLogEntry, AppLogStatus } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function recordLogBestEffort(entry: AppLogEntry): void {
  void invokeCommand<void>('append_app_log', { payload: { entry } satisfies AppendAppLogPayload }).catch(ignoreLogFailure);
}

function ignoreLogFailure(): void {
  return;
}

export function loadLogStatus(): Promise<AppLogStatus> {
  return invokeCommand('get_app_log_status');
}

export function openLogFile(): Promise<void> {
  return invokeCommand('open_app_log_file');
}

export function clearLog(): Promise<AppLogStatus> {
  return invokeCommand('clear_app_log_file');
}
