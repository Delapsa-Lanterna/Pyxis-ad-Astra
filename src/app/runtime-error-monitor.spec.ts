import { createApp, h } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppLogEntry } from '@/shared/types';
import { appLogQueue } from '@/shared/runtime/app-log-queue';

import { installRuntimeErrorMonitor, installVueErrorHandlers, setRuntimeErrorContext } from './runtime-error-monitor';

describe('runtime error logging', () => {
  let records: AppLogEntry[];
  let release: (() => void) | undefined;
  beforeEach(() => {
    records = [];
    appLogQueue.setLevel('debug');
    appLogQueue.install(
      async (entries) => {
        records.push(...entries);
      },
      () => {},
    );
    release = installRuntimeErrorMonitor();
  });
  afterEach(() => {
    release?.();
    release = undefined;
    appLogQueue.setLevel('info');
  });
  it('records global errors and unhandled rejections with runtime context', async () => {
    const clear = setRuntimeErrorContext(() => ({ page: 'table', saving: 'true' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'white screen', filename: 'app.js', lineno: 12, colno: 3 }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('rejected') }));
    await Promise.resolve();
    await appLogQueue.flush();
    expect(records.map((entry) => entry.level)).toEqual(['error', 'error']);
    expect(records[0]!.fields).toMatchObject({ page: 'table', saving: 'true' });
    clear();
  });
  it('routes Vue render failures to error and Vue warnings to debug', async () => {
    const app = createApp({ render: () => h('div') });
    installVueErrorHandlers(app);
    app.config.errorHandler!(new Error('render failed'), null, 'render');
    app.config.warnHandler!('warning', null, 'trace');
    await appLogQueue.flush();
    expect(records.map((entry) => [entry.level, entry.code])).toEqual([
      ['error', 'runtime.vue_error'],
      ['debug', 'runtime.vue_warning'],
    ]);
  });
});
