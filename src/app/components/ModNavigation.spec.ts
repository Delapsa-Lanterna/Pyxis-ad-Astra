import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, provide } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentNavigationKey, createContentNavigation } from '@/app/composables/use-content-navigation';
import { useWorkspaceStore } from '@/stores/workspace.store';
import ModNavigation from './ModNavigation.vue';
import ModTabsBar from './ModTabsBar.vue';

const actions = vi.hoisted(() => ({ showOverview: vi.fn() }));
vi.mock('@/app/composables/use-workspace-navigation-actions', () => ({ useWorkspaceNavigationActions: () => actions }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
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

  it('opens the workspace overview from the single leading tab-bar action', async () => {
    const view = mountNavigation(1000);
    const bar = view.get('.mod-tabs-bar');
    const overview = bar.get('[aria-label="打开工作区总览"]');
    expect(bar.element.firstElementChild).toBe(overview.element);
    expect(bar.element.lastElementChild?.getAttribute('role')).toBe('tablist');
    await overview.trigger('click');
    expect(actions.showOverview).toHaveBeenCalledExactlyOnceWith();
    view.unmount();
  });
});
