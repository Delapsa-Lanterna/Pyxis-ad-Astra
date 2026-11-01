import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { ErrorDiagnostic, CloseScope, CloseResult, ClosePhase } from '@/shared/types';

export function requestClose(scope: CloseScope) {
  return invokeCommand<CloseResult>('request_close', { scope });
}
export function replyNativeClose(operationId: number, phase: ClosePhase, accepted: boolean, diagnostic: ErrorDiagnostic | null = null) {
  return invokeCommand<void>('reply_close', { operationId, phase, accepted, diagnostic });
}
export function readyNativeClose() {
  return invokeCommand<void>('ready_close');
}
