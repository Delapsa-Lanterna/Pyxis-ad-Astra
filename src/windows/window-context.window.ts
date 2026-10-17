import { computed, readonly, shallowRef } from 'vue';
import {
  getNativeWindowBootstrap,
  getNativeWindowContext,
  getNativeWindowRequest,
  acceptNativeWindowRequest,
  failNativeWindowRequest,
  failNativeWindowStartup,
} from '@/services/window.service';
import { listenWindowEvent, type WindowEventErrorHandler } from './tauri.events';
import { WINDOW_EVENTS } from './window.events';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import type { DeepReadonly, ManagedWindowContext, WindowContextFor } from '@/shared/types';
let requestDrain: Promise<void> = Promise.resolve();
export function settleWindowRequests() {
  return requestDrain;
}
let restoring = false;
const context = shallowRef<ManagedWindowContext | null>(null);
const modName = shallowRef('');
export const windowModName = readonly(modName);
export const managedWindowContext = readonly(context);
export function publishWindowContext(next: ManagedWindowContext) {
  if (context.value && next.revision < context.value.revision) return;
  context.value = next;
}
export async function initializeWindowContext() {
  const bootstrap = await getNativeWindowBootstrap();
  if (bootstrap.kind === 'managed') {
    modName.value = bootstrap.modName;
    publishWindowContext(bootstrap.context);
    restoring = bootstrap.restoring;
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
export function failWindowStartup(error: unknown) {
  return failNativeWindowStartup(errorDiagnosticOf(error));
}
export function subscribeWindowRequests(handler: (next: ManagedWindowContext) => void | Promise<void>, onError: WindowEventErrorHandler) {
  let disposed = false,
    running = false,
    queued = false;
  let stop: (() => void) | null = null;
  function drain() {
    if (running) {
      queued = true;
      return requestDrain;
    }
    requestDrain = executeDrain();
    return requestDrain;
  }
  async function executeDrain() {
    queued = true;
    if (running || disposed) return;
    running = true;
    try {
      if (restoring && context.value) {
        restoring = false;
        await handler(context.value);
      }
      while (queued && !disposed) {
        queued = false;
        const request = await getNativeWindowRequest();
        if (!request || disposed) continue;
        try {
          await handler(request);
          if (disposed) return;
          const accepted = await acceptNativeWindowRequest(request.requestId, request.receiverGeneration);
          if (accepted) {
            const next = await getNativeWindowContext();
            if (!disposed) publishWindowContext(next);
          }
          queued = true;
        } catch (error) {
          if (disposed) return;
          await failNativeWindowRequest(request.requestId, request.receiverGeneration, errorDiagnosticOf(error));
          queued = true;
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
