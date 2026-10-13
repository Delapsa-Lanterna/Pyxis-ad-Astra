import { invokeCommand } from '@/shared/runtime/command.runtime';
import { withCause } from '@/shared/lib/errors';
import type { ManagedWindowOpened, ManagedWindowStatus, NativeWindowRequest, WindowIdentity } from '@/shared/types';
import type {
  WindowBootstrap,
  ManagedWindowContext,
  WindowSettingsSnapshot,
  WindowRequestReceipt,
  AppSettings,
  ErrorDiagnostic,
} from '@/shared/types';
import type { EditWriteTarget, ManagedWindowInput } from '@/shared/types';

export function updateEditTargetRegistration(targets: EditWriteTarget[]): Promise<void> {
  return invokeCommand('update_edit_target_registration', { targets });
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

export async function openNativeManagedWindow(request: NativeWindowRequest) {
  try {
    return await invokeCommand<ManagedWindowOpened>('open_managed_window', { payload: request });
  } catch (error) {
    throw withCause(`打开窗口「${request.title}」失败`, error, 'open-managed-window');
  }
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
export function closeNativeSessionWindows(sessionId: string) {
  return invokeCommand<boolean>('request_session_window_close', { sessionId });
}
export function cancelNativeWindowClose(requestId: number) {
  return invokeCommand<void>('cancel_window_close_request', { requestId });
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
export function acceptNativeWindowRequest(requestId: number) {
  return invokeCommand<boolean>('accept_window_request', { requestId });
}
export function failNativeWindowRequest(requestId: number, diagnostic: ErrorDiagnostic) {
  return invokeCommand<void>('fail_window_request', { requestId, diagnostic });
}
export function failNativeWindowStartup(diagnostic: ErrorDiagnostic) {
  return invokeCommand<void>('fail_window_startup', { diagnostic });
}
export function awaitNativeWindowRequest(requestId: number) {
  return invokeCommand<WindowRequestReceipt>('await_window_request', { requestId });
}
export function publishNativeWindowSettings(settings: AppSettings) {
  return invokeCommand<WindowSettingsSnapshot>('publish_window_settings', { settings });
}
export function getNativeWindowSettings() {
  return invokeCommand<WindowSettingsSnapshot>('get_window_settings');
}
