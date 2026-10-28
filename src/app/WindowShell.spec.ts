import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WindowShell from './WindowShell.vue';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreFields } from '@/orchestrators/core-assets.orchestrator';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { nPopover } from '@/test/unit/ui-stubs';

const mocks = vi.hoisted(() => ({ fields: vi.fn(), graphics: vi.fn(), log: vi.fn() }));
vi.mock('@/services/core-assets.service', () => ({ queryCoreFields: mocks.fields, queryCoreGraphics: mocks.graphics }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('./WindowRuntime.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/app/components/ContextMenu.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/app/composables/use-window-image-runtime', () => ({ useWindowImageRuntimeLifetime: vi.fn() }));
vi.mock('@/app/composables/use-app-lifecycle-assembly', async (original) => ({
  ...(await original<typeof import('@/app/composables/use-app-lifecycle-assembly')>()),
  useAppSettings: vi.fn(),
}));
vi.mock('@/app/composables/settings/use-theme-dom-effect', () => ({ useThemeDomEffect: vi.fn() }));

let wrapper: VueWrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ starsectorRoot: null }));
  vi.clearAllMocks();
  mocks.fields.mockResolvedValue({});
  mocks.graphics.mockResolvedValue([]);
});
afterEach(() => wrapper?.unmount());

function register(sessionId: string, modRoot: string, starsectorRoot: string) {
  const update = sessionUpdateFixture(sessionId, modRoot);
  useProjectStore().registerProjectManifest({ ...update.projection.manifest, starsectorRoot });
  useWorkspaceStore().registerMod({ modRoot, displayName: sessionId, version: '', status: 'ready' });
}
function mountWindow(mode: 'main' | 'child') {
  const provider = { template: '<div><slot /></div>' };
  wrapper = mount(WindowShell, {
    props: { mode },
    global: { stubs: { NConfigProvider: provider, NMessageProvider: provider, NDialogProvider: provider, NPopover: nPopover } },
  });
}

describe('window Core root assembly', () => {
  it('shares one title tooltip, accepts updated content and restores attributes on release', async () => {
    vi.useFakeTimers();
    mountWindow('main');
    const target = document.createElement('button');
    target.title = 'field\nDescription';
    document.body.append(target);
    try {
      target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(target.title).toBe('');
      await vi.advanceTimersByTimeAsync(400);
      expect(wrapper.findAll('[role="tooltip"]')).toHaveLength(1);
      expect(wrapper.get('[role="tooltip"]').text()).toBe('field\nDescription');
      target.title = 'Updated';
      await vi.advanceTimersByTimeAsync(0);
      expect(wrapper.get('[role="tooltip"]').text()).toBe('Updated');
      document.dispatchEvent(new Event('scroll'));
      await nextTick();
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      wrapper.unmount();
      expect(target.title).toBe('Updated');
    } finally {
      target.remove();
      vi.useRealTimers();
    }
  });
  it.each(['main', 'child'] as const)('projects settings priority and active manifest fallback in a %s window', async (mode) => {
    register('alpha', 'M:/alpha', 'D:/game-alpha');
    register('beta', 'M:/beta', 'D:/game-beta');
    const workspace = useWorkspaceStore();
    const settings = useSettingsStore();
    workspace.activateModOverview('M:/alpha');
    mountWindow(mode);
    const core = useCoreAssetsStore();
    expect(core.root).toBe('D:/game-alpha');
    expect(mocks.fields).not.toHaveBeenCalled();
    await loadCoreFields();
    settings.setStarsectorRoot('D:/settings');
    expect(core.root).toBe('D:/settings');
    workspace.activateModOverview('M:/beta');
    expect(core.root).toBe('D:/settings');
    settings.setStarsectorRoot(null);
    expect(core.root).toBe('D:/game-beta');
    expect(mocks.fields).toHaveBeenLastCalledWith('D:/game-beta');
    expect(mocks.graphics).toHaveBeenLastCalledWith('D:/game-beta');
    useProjectStore().removeProjectManifest('M:/beta');
    expect(core.root).toBeNull();
    await flushPromises();
    expect(core.fields.status).toBe('idle');
    wrapper.unmount();
    workspace.activateModOverview('M:/alpha');
    settings.setStarsectorRoot('D:/released');
    await nextTick();
    expect(core.root).toBeNull();
  });

  it('uses the restored game overview root before an active Mod exists', async () => {
    mountWindow('main');
    useWorkspaceStore().setGameOverview({
      starsectorRoot: 'D:/restored-game',
      coreAvailable: true,
      modsDir: 'D:/restored-game/mods',
      mods: [],
      warnings: [],
    });
    expect(useCoreAssetsStore().root).toBe('D:/restored-game');
    await flushPromises();
    expect(mocks.fields).toHaveBeenCalledWith('D:/restored-game');
    expect(mocks.graphics).toHaveBeenCalledWith('D:/restored-game');
  });
});
