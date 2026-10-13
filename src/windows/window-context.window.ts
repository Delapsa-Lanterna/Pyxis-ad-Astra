import { computed, readonly, shallowRef } from 'vue';
import {
  getNativeWindowBootstrap,
  getNativeWindowContext,
  getNativeWindowRequest,
  acceptNativeWindowRequest,
  failNativeWindowRequest,
  failNativeWindowStartup,
  getNativeWindowSettings,
  publishNativeWindowSettings,
} from '@/services/window.service';
import { listenWindowEvent, type WindowEventErrorHandler } from './tauri.events';
import { WINDOW_EVENTS } from './window.events';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { DeepReadonly, AppSettings, ManagedWindowContext, WindowContextFor, WindowSettingsSnapshot } from '@/shared/types';
const context = shallowRef<ManagedWindowContext | null>(null);
let settingsRevision = 0;
export const managedWindowContext = readonly(context);
export function publishWindowContext(next: ManagedWindowContext) {
  if (context.value && next.revision < context.value.revision) return;
  context.value = next;
}
export async function initializeWindowContext() {
  const bootstrap = await getNativeWindowBootstrap();
  if (bootstrap.kind === 'managed') {
    publishWindowContext(bootstrap.context);
    settingsRevision = bootstrap.settings.revision;
  }
  return bootstrap;
}
export function useWindowContext<K extends ManagedWindowContext['kind']>(kind: K) {
  return computed(() => {
    const current = context.value;
    if (!current || current.kind !== kind) throw new AppError('窗口上下文与界面不匹配', { action: 'window-context' });
    return readonly(current) as DeepReadonly<WindowContextFor<K>>;
  });
}
export async function refreshWindowContext() {
  publishWindowContext(await getNativeWindowContext());
}
export function failWindowStartup(error: unknown) {
  return failNativeWindowStartup(errorDiagnosticOf(error));
}
export function publishWindowSettings(settings: AppSettings) {
  return publishNativeWindowSettings(settings);
}
export function readWindowSettings() {
  return getNativeWindowSettings();
}
export function acceptWindowSettings(snapshot: WindowSettingsSnapshot) {
  if (snapshot.revision <= settingsRevision) return false;
  settingsRevision = snapshot.revision;
  return true;
}
export function subscribeWindowRequests(handler: (next: ManagedWindowContext) => void | Promise<void>, onError: WindowEventErrorHandler) {
  let disposed = false,
    running = false,
    queued = false;
  let stop: (() => void) | null = null;
  async function drain() {
    queued = true;
    if (running || disposed) return;
    running = true;
    try {
      while (queued && !disposed) {
        queued = false;
        const request = await getNativeWindowRequest();
        if (!request || disposed) continue;
        try {
          await handler(request);
          if (disposed) return;
          const accepted = await acceptNativeWindowRequest(request.requestId);
          if (accepted) {
            const next = await getNativeWindowContext();
            if (!disposed) publishWindowContext(next);
          } else queued = true;
        } catch (error) {
          if (disposed) return;
          await failNativeWindowRequest(request.requestId, errorDiagnosticOf(error));
        }
      }
    } catch (error) {
      if (!disposed) {
        onError(error, WINDOW_EVENTS.managedWindowRequestAvailable);
        await failWindowStartup(error).catch((error) => onError(error, WINDOW_EVENTS.managedWindowRequestAvailable));
      }
    } finally {
      running = false;
    }
  }
  void listenWindowEvent<number>(WINDOW_EVENTS.managedWindowRequestAvailable, drain, onError)
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      stop = unlisten;
      void drain();
    })
    .catch((error) => {
      if (!disposed) {
        onError(error, WINDOW_EVENTS.managedWindowRequestAvailable);
        void failWindowStartup(error).catch((error) => onError(error, WINDOW_EVENTS.managedWindowRequestAvailable));
      }
    });
  return () => {
    disposed = true;
    stop?.();
  };
}
