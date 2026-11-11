import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
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
