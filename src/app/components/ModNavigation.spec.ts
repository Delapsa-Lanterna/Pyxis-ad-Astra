import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, provide, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentNavigationKey, createContentNavigation } from '@/app/composables/use-content-navigation';
import { useWorkspaceStore } from '@/stores/workspace.store';
import ModNavigation from './ModNavigation.vue';
import ModTabsBar from './ModTabsBar.vue';

const actions = vi.hoisted(() => ({ showOverview: vi.fn(), openCore: vi.fn() }));
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
        return () => h('div', [h(ModTabsBar), h(ModNavigation)]);
      },
    }),
    { attachTo: document.body },
  );
}

describe('workspace navigation controls', () => {
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
