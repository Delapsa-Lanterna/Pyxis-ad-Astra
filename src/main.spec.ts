import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createSettingsFixture } from '@/test/fixtures/settings';

const api = vi.hoisted(() => ({
  context: vi.fn(),
  settings: vi.fn(),
  log: vi.fn(),
  monitor: vi.fn(),
  show: vi.fn(),
  report: vi.fn(),
  record: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
  create: vi.fn(),
  initialize: vi.fn(),
}));
vi.mock('vue', () => ({ createApp: api.create }));
vi.mock('pinia', () => ({ createPinia: () => ({}) }));
vi.mock('@/app/naive-ui.runtime', () => ({ installNaiveUi: vi.fn() }));
vi.mock('@/orchestrators/settings-persistence.orchestrator', () => ({ initializeSettings: api.settings }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: api.record }));
vi.mock('@/app/performance-monitor', () => ({ startPerformanceMonitor: api.monitor }));
vi.mock('@/app/application-log', () => ({ startApplicationLog: api.log }));
vi.mock('@/app/runtime-error-monitor', () => ({ installRuntimeErrorMonitor: vi.fn(), installVueErrorHandlers: vi.fn() }));
vi.mock('@/stores/settings.store', () => ({ initializeSettingsStore: api.initialize }));
vi.mock('@/windows/current.window', () => ({ showCurrentWindow: api.show }));
vi.mock('@/windows/window-context.window', () => ({ initializeWindowContext: api.context, failWindowStartup: api.report }));
vi.mock('@/app/App.vue', () => ({ default: { name: 'RootFixture' } }));
vi.mock('@/app/StartupFailure.vue', () => ({ default: { name: 'FailureFixture' } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  api.context.mockResolvedValue({ kind: 'main' });
  api.settings.mockResolvedValue({ revision: 1, value: createSettingsFixture(), performanceMonitorActive: false });
  api.log.mockResolvedValue(undefined);
  api.report.mockResolvedValue(undefined);
  api.show.mockResolvedValue(undefined);
  api.create.mockReturnValue({ use: () => ({ mount: api.mount }), mount: api.mount, unmount: api.unmount });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => window.dispatchEvent(new Event('pagehide')));

for (const stage of ['context', 'settings', 'log'] as const)
  it.each(['success', 'error'] as const)('ends a late ' + stage + ' %s with the owning page', async (outcome) => {
    let finish!: (value: unknown) => void, fail!: (error: Error) => void;
    api[stage].mockReturnValueOnce(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    await import('./main');
    await flushPromises();
    window.dispatchEvent(new Event('pagehide'));
    if (outcome === 'error') fail(new Error('late fixture'));
    else finish(stage === 'context' ? { kind: 'main' } : { value: createSettingsFixture() });
    await flushPromises();
    expect(api.mount).not.toHaveBeenCalled();
    expect(api.monitor).not.toHaveBeenCalled();
    expect(api.show).not.toHaveBeenCalled();
    expect(api.report).not.toHaveBeenCalled();
  });

it('mounts and shows a live window after its dependencies are ready', async () => {
  await import('./main');
  await flushPromises();
  expect(api.initialize).toHaveBeenCalledWith(createSettingsFixture());
  expect(api.mount).toHaveBeenCalledExactlyOnceWith('#app');
  expect(api.show).toHaveBeenCalledOnce();
});

it('presents startup failure on a live page and ends late diagnostic reporting on release', async () => {
  const error = new Error('startup fixture');
  api.settings.mockRejectedValueOnce(error);
  let fail!: (error: Error) => void;
  api.report.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  await import('./main');
  await flushPromises();
  expect(api.report).toHaveBeenCalledWith(error);
  expect(api.mount).toHaveBeenCalledWith(document.querySelector('#app'));
  expect(api.show).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('pagehide'));
  fail(new Error('late report fixture'));
  await flushPromises();
  expect(api.record).not.toHaveBeenCalled();
});
