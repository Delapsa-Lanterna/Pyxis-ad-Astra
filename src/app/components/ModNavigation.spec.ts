import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, provide, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentNavigationKey, createContentNavigation } from '@/app/composables/use-content-navigation';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import ModNavigation from './ModNavigation.vue';
import ModTabsBar from './ModTabsBar.vue';

const actions = vi.hoisted(() => ({ showOverview: vi.fn(), openCore: vi.fn() }));
const refreshActions = { refreshWorkspace: vi.fn(), refreshModOverview: vi.fn(), refreshTabInfo: vi.fn(), refreshCore: vi.fn() };
const coreModRoot = ref<string | null>(null);
vi.mock('@/app/composables/use-workspace-navigation-actions', () => ({
  useWorkspaceNavigationActions: () => ({ ...actions, coreModRoot }),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  coreModRoot.value = null;
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: 'M:/navigation', displayName: 'Navigation', version: '', status: 'ready' });
  workspace.activateModTab('M:/navigation');
});
afterEach(() => vi.restoreAllMocks());

function mountNavigation(width: number) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
  return mount(
    defineComponent({
      setup() {
        provide(contentNavigationKey, createContentNavigation());
        return () => h('div', [h(ModTabsBar, { refreshActions }), h(ModNavigation)]);
      },
    }),
    { attachTo: document.body },
  );
}

describe('workspace navigation controls', () => {
  it.each(['ready', 'loading', 'error', 'dirty'] as const)('shows the Core status beside its icon: %s', async (status) => {
    coreModRoot.value = 'D:/game/starsector-core';
    const core = useCoreAssetsStore();
    core.fields.status = status === 'dirty' ? 'ready' : status;
    useDraftSessionsStore().registerDraftSession(ref(coreModRoot.value), ref(status === 'dirty'));
    const view = mountNavigation(1000);
    const button = view.get('[aria-label="打开原版"]');
    const light = button.get(status === 'dirty' ? '.mod-tab-dirty' : '.mod-tab-status');
    expect(light.attributes('title')).toBe(
      status === 'dirty' ? '有未保存修改' : status === 'loading' ? '加载中' : status === 'error' ? '读取失败' : '已加载',
    );
    expect(button.get('svg').element.nextElementSibling).toBe(light.element);
    view.unmount();
  });
  it('commits a dropped tab order and preserves flags, selection and cancelled drags', async () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'M:/other', displayName: 'Other', version: '', status: 'ready', referenceable: true });
    const view = mountNavigation(1000);
    const own = view.get('[data-mod-root="M:/navigation"]');
    const other = view.get('[data-mod-root="M:/other"]');
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };
    await other.get('[role="tab"]').trigger('dragstart', { dataTransfer });
    await own.trigger('dragover', { clientX: -1 });
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual(['M:/navigation', 'M:/other']);
    await own.trigger('drop');
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual(['M:/other', 'M:/navigation']);
    expect(workspace.activeModRoot).toBe('M:/navigation');
    expect(other.classes()).toContain('referenceable');
    await own.get('[role="tab"]').trigger('dragstart', { dataTransfer });
    await other.trigger('dragover', { clientX: -1 });
    await own.get('[role="tab"]').trigger('dragend');
    await other.trigger('drop');
    expect(workspace.loadedModList.map((mod) => mod.modRoot)).toEqual(['M:/other', 'M:/navigation']);
    view.unmount();
  });

  it.each([1000, 600])('toggles the retained navigation with matching prompts at window width %s', async (width) => {
    const view = mountNavigation(width);
    const toggle = view.get('[aria-controls="mod-navigation-content"]');
    const content = view.get('#mod-navigation-content').element;
    const initiallyExpanded = width >= 850;
    expect(toggle.attributes('title')).toBe(initiallyExpanded ? '收起导航栏' : '展开导航栏');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe(String(!initiallyExpanded));
    expect(toggle.attributes('aria-label')).toBe(initiallyExpanded ? '展开导航栏' : '收起导航栏');
    expect(view.get('#mod-navigation-content').attributes('aria-hidden')).toBe(String(initiallyExpanded));
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe(String(initiallyExpanded));
    expect(view.get('#mod-navigation-content').element).toBe(content);
    view.unmount();
  });

  it('restores focus to the edge control after Escape closes the narrow navigation', async () => {
    const view = mountNavigation(600);
    const toggle = view.get('[aria-controls="mod-navigation-content"]');
    await toggle.trigger('click');
    await flushPromises();
    await view.get('#mod-navigation-content').trigger('keydown', { key: 'Escape' });
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle.element);
    view.unmount();
  });

  it('opens the workspace overview and hides the bar after the last project closes', async () => {
    const view = mountNavigation(1000);
    const bar = view.get('.mod-tabs-bar');
    const overview = bar.get('[aria-label="打开工作区总览"]');
    expect(bar.element.firstElementChild).toBe(overview.element);
    expect(bar.element.lastElementChild?.getAttribute('role')).toBe('tablist');
    expect(bar.find('[aria-label="打开原版"]').exists()).toBe(false);
    await overview.trigger('click');
    expect(actions.showOverview).toHaveBeenCalledExactlyOnceWith();
    coreModRoot.value = 'D:/game/starsector-core';
    useWorkspaceStore().removeLoadedModEntry('M:/navigation');
    await flushPromises();
    expect(view.find('.mod-tabs-bar').exists()).toBe(false);
    view.unmount();
  });

  it.each([1000, 600])('places the Core action beside overview at window width %s', async (width) => {
    coreModRoot.value = 'D:/game/starsector-core';
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: coreModRoot.value, displayName: 'Core', version: '', status: 'ready' });
    const view = mountNavigation(width);
    const bar = view.get('.mod-tabs-bar');
    const core = bar.get('[aria-label="打开原版"]');
    expect(bar.element.children[1]).toBe(core.element);
    expect(core.find('svg').exists()).toBe(true);
    expect(
      bar
        .get('[role="tablist"]')
        .findAll('[role="tab"]')
        .map((tab) => tab.text()),
    ).toEqual(['Navigation']);
    await core.trigger('click');
    expect(actions.openCore).toHaveBeenCalledExactlyOnceWith();
    workspace.activateModTab(coreModRoot.value);
    await flushPromises();
    expect(core.attributes('aria-pressed')).toBe('true');
    expect(core.classes()).toContain('active');
    workspace.showOverview();
    await flushPromises();
    expect(core.attributes('aria-pressed')).toBe('false');
    view.unmount();
  });
});
