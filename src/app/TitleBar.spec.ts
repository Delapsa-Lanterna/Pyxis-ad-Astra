import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TitleBar from './TitleBar.vue';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';

const actions = vi.hoisted(() => ({ close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), drag: vi.fn(), maximized: vi.fn() }));
vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: actions.close,
  minimizeCurrentWindow: actions.minimize,
  toggleMaximizeCurrentWindow: actions.maximize,
  startCurrentWindowDrag: actions.drag,
  isCurrentWindowMaximized: actions.maximized,
}));
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  actions.maximized.mockResolvedValue(false);
});
afterEach(() => wrapper?.unmount());

describe('child window titlebar', () => {
  it.each(['沉浸式编辑器', '文件编辑器', 'Spec 编辑器', '发射预览'])(
    'presents %s and its owning Mod with native window actions',
    async (title) => {
      const pinia = createPinia();
      setActivePinia(pinia);
      initializeSettingsStore(createSettingsFixture());
      wrapper = mount(TitleBar, { props: { title, subtitle: 'Owning Mod' }, global: { plugins: [pinia] } });
      await flushPromises();
      expect(wrapper.get('.titlebar-text-value').text()).toBe(title);
      expect(wrapper.get('.titlebar-text-label').text()).toBe('Owning Mod');
      expect(wrapper.findAll('button').map((button) => button.attributes('title'))).toEqual(['最小化', '最大化', '关闭']);
      await wrapper.get('button[title="最小化"]').trigger('click');
      expect(actions.minimize).toHaveBeenCalledOnce();
      actions.maximized.mockResolvedValue(true);
      await wrapper.get('button[title="最大化"]').trigger('click');
      await flushPromises();
      expect(actions.maximize).toHaveBeenCalledOnce();
      expect(wrapper.get('button[title="还原"]').attributes('title')).toBe('还原');
      await wrapper.get('button[title="关闭"]').trigger('click');
      expect(actions.close).toHaveBeenCalledOnce();
      await wrapper.setProps({ subtitle: 'Updated Mod' });
      expect(wrapper.get('.titlebar-text-label').text()).toBe('Updated Mod');
    },
  );
});
