import type { App, ComponentPublicInstance } from 'vue';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import { recordQueuedLog, type RuntimeLogContext } from '@/shared/runtime/app-log-queue';

let installed = false;

function stackOf(error: unknown) {
  return error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined;
}

function componentName(instance: ComponentPublicInstance | null) {
  return instance?.$options.name ?? undefined;
}

function recordRuntimeError(level: 'warning' | 'error' | 'debug', code: string, error: unknown, fields: RuntimeLogContext = {}) {
  const diagnostic = errorDiagnosticOf(error);
  recordQueuedLog({
    level,
    code,
    message: diagnostic.message,
    path: diagnostic.location?.path ?? null,
    line: diagnostic.location?.line ?? null,
    fields: logFields({ ...errorContextOf(error), ...fields, stack: stackOf(error) }),
  });
}

function onError(event: ErrorEvent | Event) {
  if (event instanceof ErrorEvent) {
    recordRuntimeError('error', 'runtime.window_error', event.error ?? event.message, {
      event: 'window.error',
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const tag = target?.tagName.toLowerCase() ?? '';
  recordRuntimeError(tag === 'script' || tag === 'link' ? 'error' : 'warning', 'runtime.resource_error', 'Resource load failed', {
    event: 'resource.error',
    tag,
    resource: target?.getAttribute('src') ?? target?.getAttribute('href'),
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent) {
  const expected = isReadInvalidated(event.reason);
  recordRuntimeError(
    expected ? 'debug' : 'error',
    expected ? 'runtime.unhandled_read_invalidated' : 'runtime.unhandled_rejection',
    event.reason,
    {
      event: 'unhandledrejection',
    },
  );
}

export { setRuntimeErrorContext } from '@/shared/runtime/app-log-queue';

export function installRuntimeErrorMonitor() {
  if (installed) return () => {};
  installed = true;
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    if (!installed) return;
    installed = false;
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

export function installVueErrorHandlers(app: App) {
  const previousError = app.config.errorHandler;
  const previousWarning = app.config.warnHandler;
  app.config.errorHandler = (error, instance, info) => {
    recordRuntimeError('error', 'runtime.vue_error', error, { event: 'vue.error', component: componentName(instance), info });
    previousError?.(error, instance, info);
  };
  app.config.warnHandler = (message, instance, trace) => {
    recordRuntimeError('debug', 'runtime.vue_warning', message, { event: 'vue.warning', component: componentName(instance), trace });
    previousWarning?.(message, instance, trace);
  };
}
