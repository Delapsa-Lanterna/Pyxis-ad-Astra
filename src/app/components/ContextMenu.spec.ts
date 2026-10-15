import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.vue';
import TitleBar from '@/app/TitleBar.vue';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { NDropdown } from 'naive-ui/es/dropdown';
import { NConfigProvider } from 'naive-ui/es/config-provider';
import { createThemeColors } from '@/domain/settings/theme';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import { buildThemeOverrides } from '@/app/theme-overrides';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => 'paste'),
  write: vi.fn(async () => {}),
  settings: vi.fn(),
  about: vi.fn(),
  minimize: vi.fn(async () => {}),
  exit: vi.fn(async () => {}),
  drag: vi.fn(async () => {}),
  error: vi.fn(),
}));
vi.mock('@/shared/runtime/clipboard.runtime', () => ({ readClipboardText: mocks.read, writeClipboardText: mocks.write }));
vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: mocks.exit,
  minimizeCurrentWindow: mocks.minimize,
  startCurrentWindowDrag: mocks.drag,
  isCurrentWindowMaximized: vi.fn(async () => false),
  toggleMaximizeCurrentWindow: vi.fn(async () => {}),
}));
vi.mock('@/app/composables/use-workspace-navigation-actions', () => ({
  useWorkspaceNavigationActions: () => ({ showSettings: mocks.settings, showAbout: mocks.about }),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
let wrapper: ReturnType<typeof mount>;
function setup(readOnly = false) {
  const identity = ref('A'),
    refresh = vi.fn();
  wrapper = mount(ContextMenu, {
    attachTo: document.body,
    slots: {
      default: defineComponent({
        setup() {
          useContextMenuScope({ identity: () => identity.value, refresh });
          return () =>
            h('main', [
              h('textarea', { value: 'hello', readOnly }),
              h('canvas', { onContextmenu: (event: Event) => event.preventDefault() }),
            ]);
        },
      }),
    },
  });
  return { identity, refresh };
}
function dropdown() {
  return wrapper.findComponent(NDropdown);
}
async function open(target: Element) {
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
  await flushPromises();
}
async function select(key: string) {
  dropdown().vm.$emit('select', key);
  await flushPromises();
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
});
describe('window context menu', () => {
  it.each(['设置', '关于', '最小化', '退出'] as const)('dispatches titlebar %s through its existing action', async (key) => {
    wrapper = mount(ContextMenu, {
      attachTo: document.body,
      slots: { default: TitleBar },
      global: { stubs: { NPopover: { template: '<div><slot name="trigger" /><slot /></div>' } } },
    });
    wrapper.get('header').element.dispatchEvent(new MouseEvent('pointerdown', { button: 2, detail: 1, bubbles: true }));
    await open(wrapper.get('header').element);
    expect((dropdown().props('options')! as { key: string }[]).map((option) => option.key)).toEqual([
      '设置',
      '关于',
      'separator',
      '最小化',
      '退出',
    ]);
    expect(document.querySelector('.context-menu-danger')?.textContent).toBe('退出');
    await select(key);
    expect({ 设置: mocks.settings, 关于: mocks.about, 最小化: mocks.minimize, 退出: mocks.exit }[key]).toHaveBeenCalledOnce();
    expect(mocks.drag).not.toHaveBeenCalled();
    const outside = document.createElement('p');
    document.body.append(outside);
    try {
      await open(outside);
      expect((dropdown().props('options')! as { key: string }[]).map((option) => option.key)).toEqual(['刷新']);
    } finally {
      outside.remove();
    }
  });
  it('separates selected-text copying from refresh and skips the divider by keyboard', async () => {
    const own = setup();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'selected';
    wrapper.get('main').element.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    await open(paragraph);
    expect((dropdown().props('options')! as { key: string }[]).map((option) => option.key)).toEqual(['复制', 'separator', '刷新']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    await flushPromises();
    expect(dropdown().props('value')).toBe('刷新');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await flushPromises();
    expect(own.refresh).toHaveBeenCalledOnce();
    window.getSelection()!.removeAllRanges();
  });
  it('marks clear as danger and skips the text divider', async () => {
    setup();
    const input = wrapper.get('textarea').element;
    input.focus();
    input.setSelectionRange(0, 5);
    await open(input);
    expect(document.querySelector('.context-menu-danger')?.textContent).toBe('清空');
    for (let i = 0; i < 4; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    await flushPromises();
    expect(dropdown().props('value')).toBe('清空');
  });
  it.each(['ArrowDown', 'ArrowUp'])('opens unselected and starts keyboard navigation with %s', async (key) => {
    const own = setup();
    await open(wrapper.get('main').element);
    expect(dropdown().props('value')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await flushPromises();
    expect(dropdown().exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    await flushPromises();
    expect(dropdown().props('value')).toBe('刷新');
    if (key === 'ArrowDown') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      await flushPromises();
      expect(own.refresh).toHaveBeenCalledOnce();
      await open(wrapper.get('main').element);
      expect(dropdown().props('value')).toBeUndefined();
    }
  });
  it('skips disabled actions during keyboard navigation', async () => {
    setup();
    await open(wrapper.get('textarea').element);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    await flushPromises();
    expect(dropdown().props('value')).toBe('粘贴');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    await flushPromises();
    expect(dropdown().props('value')).toBe('全选');
  });
  it.each([createThemeColors('#2563eb', 'light'), createThemeColors('#2563eb', 'dark'), IMMERSIVE_COLORS])(
    'uses its window neutral colors and a flat compact menu',
    async (colors) => {
      wrapper = mount(
        defineComponent({
          setup: () => () =>
            h(
              NConfigProvider,
              { themeOverrides: buildThemeOverrides(colors, 'sans-serif') },
              {
                default: () => h(ContextMenu, {}, { default: () => h('main') }),
              },
            ),
        }),
        { attachTo: document.body },
      );
      await open(wrapper.get('main').element);
      expect(dropdown().props('themeOverrides')).toMatchObject({
        optionColorActive: colors.surfaceHover,
        optionTextColorActive: colors.textSoft,
        peers: { Popover: { boxShadow: 'none' } },
      });
      expect(dropdown().props('size')).toBe('small');
      expect(document.querySelector('.window-context-menu')).not.toBeNull();
    },
  );
  it('refreshes through the registered root and keeps canvas panning exempt', async () => {
    const own = setup();
    await open(wrapper.get('canvas').element);
    expect(dropdown().exists()).toBe(false);
    await open(wrapper.get('main').element);
    expect((dropdown().props('options')! as { key: string }[]).map((option) => option.key)).toEqual(['刷新']);
    await select('刷新');
    expect(own.refresh).toHaveBeenCalledOnce();
  });
  it.each([false, true])('copies only the selection and offers read-only actions: %s', async (readOnly) => {
    setup(readOnly);
    const input = wrapper.get('textarea').element;
    input.focus();
    input.setSelectionRange(1, 4);
    await open(input);
    expect((dropdown().props('options')! as { key: string }[]).map((option) => option.key)).toEqual(
      readOnly ? ['复制', '全选'] : ['复制', '粘贴', '剪切', 'separator', '清空', '全选'],
    );
    await select('复制');
    expect(mocks.write).toHaveBeenCalledWith('ell');
    expect(input.value).toBe('hello');
    expect(document.activeElement).toBe(input);
    await open(input);
    await select('全选');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });
  it('closes on identity handoff and Escape while keeping the editor open', async () => {
    const own = setup();
    await open(wrapper.get('main').element);
    own.identity.value = 'B';
    await flushPromises();
    expect(dropdown().exists()).toBe(false);
    await open(wrapper.get('main').element);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await flushPromises();
    expect(dropdown().exists()).toBe(false);
    expect(mocks.exit).not.toHaveBeenCalled();
  });
  it('rejects a clipboard result after its target changes', async () => {
    const own = setup();
    let finish!: (text: string) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const input = wrapper.get('textarea').element;
    input.focus();
    input.setSelectionRange(1, 4);
    await open(input);
    dropdown().vm.$emit('select', '粘贴');
    await flushPromises();
    own.identity.value = 'B';
    own.identity.value = 'A';
    finish('late');
    await flushPromises();
    expect(input.value).toBe('hello');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('reports a failed cut without changing the editable value', async () => {
    setup();
    const input = wrapper.get('textarea').element;
    input.focus();
    input.setSelectionRange(1, 4);
    mocks.write.mockRejectedValueOnce(new Error('clipboard busy'));
    await open(input);
    await select('剪切');
    expect(input.value).toBe('hello');
    expect(mocks.error).toHaveBeenCalledWith(expect.any(Error), '右键操作失败');
  });
  it('reports an executed refresh failure after the registered page changes', async () => {
    const own = setup();
    let fail!: (error: Error) => void;
    own.refresh.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    await open(wrapper.get('main').element);
    await select('刷新');
    own.identity.value = 'B';
    fail(new Error('source refresh failed'));
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '右键操作失败');
  });
});
