import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, onMounted, onUnmounted, ref } from 'vue';
import CodeWorkspaceLayout from './CodeWorkspaceLayout.vue';

afterEach(() => vi.unstubAllGlobals());
it('keeps an explicitly reopened narrow sidebar through height changes and releases observation', async () => {
  let resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const tree = ref(true),
    outline = ref(false);
  const wrapper = mount(
    defineComponent({
      components: { CodeWorkspaceLayout },
      setup: () => ({ tree, outline }),
      template:
        '<CodeWorkspaceLayout v-model:tree="tree" v-model:outline="outline" active :results="false"><template #text>Sample</template></CodeWorkspaceLayout>',
    }),
    { global: { stubs: { NSplit: { template: '<div><slot name="1"/><slot name="2"/><slot name="resize-trigger"/></div>' } } } },
  );
  const reportSize = async (width: number, height: number) => {
    resize([{ contentRect: { width, height } }] as ResizeObserverEntry[], {} as ResizeObserver);
    await nextTick();
  };
  try {
    await reportSize(600, 500);
    expect(tree.value).toBe(false);
    tree.value = true;
    await nextTick();
    await reportSize(600, 400);
    expect(tree.value).toBe(true);
    outline.value = true;
    await nextTick();
    expect(tree.value).toBe(false);
    expect(outline.value).toBe(true);
    await reportSize(1120, 700);
    tree.value = true;
    await nextTick();
    expect(tree.value && outline.value).toBe(true);
  } finally {
    wrapper.unmount();
  }
  expect(disconnect).toHaveBeenCalledTimes(1);
});
it('retains the mounted editor while overview changes and releases it once', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let created = 0,
    released = 0;
  const content = defineComponent({
    setup() {
      onMounted(() => created++);
      onUnmounted(() => released++);
      return () => h('input', { value: 'Retained draft' });
    },
  });
  const wrapper = mount(CodeWorkspaceLayout, {
    props: { active: true, results: false, tree: false, outline: false, overview: false },
    slots: { text: content, overview: 'Code overview' },
    global: { stubs: { NSplit: { template: '<div><slot name="1"/><slot name="2"/></div>' } } },
  });
  try {
    const input = wrapper.get('input').element;
    await wrapper.setProps({ overview: true });
    expect(wrapper.text()).toContain('Code overview');
    expect(wrapper.get('input').isVisible()).toBe(false);
    await wrapper.setProps({ overview: false });
    expect(wrapper.get('input').element).toBe(input);
    expect(created).toBe(1);
    expect(released).toBe(0);
  } finally {
    wrapper.unmount();
  }
  expect(released).toBe(1);
});
