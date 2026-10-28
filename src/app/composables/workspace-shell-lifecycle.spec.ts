import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/app/composables/use-window-close-state', () => ({ useWindowLifecycleActions: () => ({ requestClose: vi.fn() }) }));
import { useWorkspaceShellLifecycle } from './use-workspace-shell-lifecycle';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import type { AppFeedback } from '@/shared/types';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), events: vi.fn(), restore: vi.fn(), stopPersistence: vi.fn() }));
vi.mock('@/orchestrators/editor-window.orchestrator', () => ({ listenEditorSpecSaved: mocks.events }));
vi.mock('@/orchestrators/workspace-persistence.orchestrator', () => ({
  restorePersistedWorkspace: mocks.restore,
  watchWorkspacePersistence: () => ({ beginRestore: vi.fn(), finishRestore: vi.fn(), stop: mocks.stopPersistence }),
}));
vi.mock('@/orchestrators/core-assets.orchestrator', () => ({ loadCoreFields: vi.fn() }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
describe('workspace shell listener lifecycle', () => {
  it('releases late event registration and ends startup', async () => {
    mocks.restore.mockImplementation(async () => {});
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
    await flushPromises();
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.stopPersistence).toHaveBeenCalledOnce();
  });
});
