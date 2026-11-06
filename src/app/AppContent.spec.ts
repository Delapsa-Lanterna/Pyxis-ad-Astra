import { flushPromises, mount, enableAutoUnmount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick, type PropType } from 'vue';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import AppContent from './AppContent.vue';
import { provideWindowCloseState } from '@/app/composables/use-window-close-state';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import type { SettingsSourceChange } from '@/orchestrators/settings-persistence.orchestrator';
import type * as WorkspaceCoreSource from '@/orchestrators/workspace-core-source.orchestrator';
import type { AppFeedback, CloseResult, CloseScope } from '@/shared/types';

enableAutoUnmount(afterEach);
const mocks = vi.hoisted(() => ({
  switchSource: vi.fn<typeof WorkspaceCoreSource.switchWorkspaceCoreSource>(),
  commit: vi.fn(async () => {}),
  started: null as Promise<boolean> | null,
}));
vi.mock('@/orchestrators/workspace-core-source.orchestrator', () => ({ switchWorkspaceCoreSource: mocks.switchSource }));
vi.mock('@/app/composables/use-workspace-shell-lifecycle', () => ({ useWorkspaceShellLifecycle: vi.fn() }));
vi.mock('@/app/composables/use-main-window-shortcuts', () => ({ useMainWindowShortcuts: vi.fn() }));
vi.mock('@/app/composables/use-context-menu', () => ({ useContextMenuScope: vi.fn() }));
vi.mock('./components/SettingsPage.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    __esModule: true,
    default: defineComponent(
      (props: { changeSource: SettingsSourceChange }) => () =>
        h(
          'button',
          {
            onClick: () => {
              mocks.started = props.changeSource('G:/selected', mocks.commit);
            },
          },
          'Switch source',
        ),
      { props: { changeSource: { type: Function as PropType<SettingsSourceChange>, required: true } } },
    ),
  };
});
vi.mock('./components/AboutPage.vue', () => ({ __esModule: true, default: { template: '<p>About</p>' } }));
const feedback: AppFeedback = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirmDanger: vi.fn(),
  confirmWarning: vi.fn(),
  choose: vi.fn(async () => null),
};
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => feedback }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.started = null;
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  useWorkspaceStore().showSettings();
});

function mountMain(requestClose: (scope: CloseScope) => Promise<CloseResult>) {
  const wrapper = mount(
    defineComponent({
      components: { AppContent },
      setup() {
        provideWindowCloseState({
          requestClose,
          createParticipant: () => ({ install: async () => {}, requestClose: async () => true, dispose: () => {} }),
        });
      },
      template: '<AppContent />',
    }),
    {
      global: {
        stubs: {
          MainWindowFrame: { template: '<div><slot /></div>' },
          TitleBar: true,
          ProjectSyncNotice: true,
          ModNavigation: true,
          ModTabsBar: true,
          NSpin: true,
        },
      },
    },
  );
  return wrapper;
}

describe('main-window settings source assembly', () => {
  it.each([true, false] as const)(
    'binds its current close action and retains a started source change across page navigation: %s',
    async (accepted) => {
      let finish!: (value: boolean) => void;
      mocks.switchSource.mockImplementationOnce(async (_root, close, commit) => {
        await close({ kind: 'sessions', sessionIds: ['captured'] });
        const result = await new Promise<boolean>((resolve) => {
          finish = resolve;
        });
        if (result) await commit();
        return result;
      });
      const requestClose = vi.fn(async (): Promise<CloseResult> => ({
        status: 'closed',
        destroyedWindows: [],
        releasedSessions: [],
        diagnostic: null,
      }));
      const wrapper = mountMain(requestClose);
      onTestFinished(async () => {
        finish?.(accepted);
        await mocks.started;
      });
      await flushPromises();
      await wrapper.get('button').trigger('click');
      await flushPromises();
      expect(mocks.switchSource).toHaveBeenCalledExactlyOnceWith('G:/selected', requestClose, mocks.commit);
      expect(requestClose).toHaveBeenCalledExactlyOnceWith({ kind: 'sessions', sessionIds: ['captured'] });
      useWorkspaceStore().showAbout();
      await nextTick();
      await flushPromises();
      expect(wrapper.find('button').exists()).toBe(false);
      expect(mocks.commit).not.toHaveBeenCalled();
      finish(accepted);
      await expect(mocks.started).resolves.toBe(accepted);
      expect(mocks.commit).toHaveBeenCalledTimes(accepted ? 1 : 0);
    },
  );
});
