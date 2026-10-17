import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { ErrorDiagnostic } from '@/shared/types';

export function requestClose(scope: import('@/shared/types').CloseScope) {
  return invokeCommand<import('@/shared/types').CloseResult>('request_close', { scope });
}
export function replyNativeClose(
  operationId: number,
  phase: import('@/shared/types').ClosePhase,
  accepted: boolean,
  diagnostic: ErrorDiagnostic | null = null,
) {
  return invokeCommand<void>('reply_close', { operationId, phase, accepted, diagnostic });
}
export function readyNativeClose() {
  return invokeCommand<void>('ready_close');
}
