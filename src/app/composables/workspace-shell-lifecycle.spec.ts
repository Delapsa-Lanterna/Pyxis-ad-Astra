import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceShellLifecycle } from './use-workspace-shell-lifecycle';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { AppFeedback } from '@/shared/types';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), events: vi.fn(), restore: vi.fn(), stopPersistence: vi.fn() }));
vi.mock('@/orchestrators/window-save.orchestrator', () => ({ listenWindowSaveEvents: mocks.events }));
vi.mock('@/orchestrators/workspace-persistence.orchestrator', () => ({
  restorePersistedWorkspace: mocks.restore,
  watchWorkspacePersistence: () => ({ beginRestore: vi.fn(), finishRestore: vi.fn(), stop: mocks.stopPersistence }),
}));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreSchema: () => ({ loadCoreFields: vi.fn() }) }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    fileHistoryLimit: 20,
    editHistoryLimit: 250,
    logRotationSizeMiB: 5,
    logBackupCount: 1,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
});
describe('workspace shell listener lifecycle', () => {
  it('releases late event registration and ends startup', async () => {
    let finish!: (stop: () => void) => void;
    const stopIdentity = vi.fn();
    mocks.identity.mockResolvedValue(stopIdentity);
    mocks.events.mockResolvedValue(vi.fn());
    mocks.events.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const feedback: AppFeedback = {
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      confirmDanger: vi.fn(),
      confirmWarning: vi.fn(),
      choose: vi.fn(async () => null),
    };
    const wrapper = mount({
      setup() {
        useWorkspaceShellLifecycle(feedback, async () => []);
        return () => null;
      },
    });
    await flushPromises();
    wrapper.unmount();
    const lateStop = vi.fn();
    finish(lateStop);
    await flushPromises();
    expect(lateStop).toHaveBeenCalledOnce();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.stopPersistence).toHaveBeenCalledOnce();
  });
});
