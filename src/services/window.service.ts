import { commandChannel, invokeCommand } from '@/shared/runtime/command.runtime';
import type { WindowSaveMessage, WindowSaveReply, WindowSaveRequest } from '@/shared/types';
import { withCause } from '@/shared/lib/errors';
import type { ManagedWindowStatus, NativeWindowRequest, WindowIdentity, WindowRequestResult } from '@/shared/types';
import type { WindowBootstrap, ManagedWindowContext, ErrorDiagnostic } from '@/shared/types';
import type { EditWriteTarget, ManagedWindowInput } from '@/shared/types';

export function updateEditTargetRegistration(targets: EditWriteTarget[]): Promise<void> {
  return invokeCommand('update_edit_target_registration', { targets });
}
export function registerWindowSaveReceiver(receive: (message: WindowSaveMessage) => void): Promise<number> {
  return invokeCommand('register_window_save_receiver', { channel: commandChannel(receive) });
}
export function unregisterWindowSaveReceiver(generation: number): Promise<void> {
  return invokeCommand('unregister_window_save_receiver', { generation });
}
export function requestWindowSave(receiver: string, request: WindowSaveRequest): Promise<WindowSaveReply> {
  return invokeCommand('request_window_save', { receiver, request });
}
export function replyWindowSave(
  message: WindowSaveMessage,
  result: WindowSaveReply | null,
  diagnostic: ErrorDiagnostic | null,
): Promise<void> {
  return invokeCommand('reply_window_save', { requestId: message.requestId, generation: message.receiverGeneration, result, diagnostic });
}
export function queryEditTargetOwners(targets: EditWriteTarget[]): Promise<string[]> {
  return invokeCommand('query_edit_target_owners', { targets });
}
export function reserveEditTargets(targets: EditWriteTarget[]): Promise<void> {
  return invokeCommand('reserve_edit_targets', { targets });
}
export function focusEditTargetOwner(label: string): Promise<boolean> {
  return invokeCommand('focus_edit_target_owner', { label });
}

export function requestNativeWindow(request: NativeWindowRequest): Promise<WindowRequestResult> {
  return invokeCommand<WindowRequestResult>('request_window', { payload: request }).catch((error) => {
    throw withCause(`打开窗口「${request.title}」失败`, error, 'open-managed-window');
  });
}
export function updateNativeWindowStatus(status: ManagedWindowStatus) {
  return invokeCommand<void>('update_managed_window_status', { payload: status });
}
export function focusNativeManagedWindow(identity: WindowIdentity): Promise<boolean> {
  return invokeCommand('focus_managed_window', { identity });
}
export function reserveNativeWindowTargets(identities: WindowIdentity[]) {
  return invokeCommand<void>('reserve_window_targets', { identities });
}
export function releaseNativeWindowTargets() {
  return invokeCommand<void>('release_window_targets');
}
export function retargetNativeWindow(identity: WindowIdentity, title: string, input: ManagedWindowInput | null = null) {
  return invokeCommand<ManagedWindowContext>('retarget_managed_window', { identity, title, input });
}
export function getNativeWindowBootstrap() {
  return invokeCommand<WindowBootstrap>('get_window_bootstrap');
}
export function getNativeWindowContext() {
  return invokeCommand<ManagedWindowContext>('get_current_window_context');
}
export function getNativeWindowRequest() {
  return invokeCommand<ManagedWindowContext | null>('get_current_window_request');
}
export function acceptNativeWindowRequest(requestId: number, receiverGeneration: number) {
  return invokeCommand<boolean>('accept_window_request', { requestId, receiverGeneration });
}
export function failNativeWindowRequest(requestId: number, receiverGeneration: number, diagnostic: ErrorDiagnostic) {
  return invokeCommand<void>('fail_window_request', { requestId, receiverGeneration, diagnostic });
}
export function failNativeWindowStartup(diagnostic: ErrorDiagnostic) {
  return invokeCommand<void>('fail_window_startup', { diagnostic });
}
