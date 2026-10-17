import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { NCollapseItem } from 'naive-ui/es/collapse';
import EditorCollapse from './EditorCollapse.vue';

describe('EditorCollapse', () => {
  it('mounts on first expansion and retains the input across later collapses', async () => {
    const update = vi.fn();
    const expanded = ref<string[]>([]);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(
            EditorCollapse,
            { expandedNames: expanded.value, 'onUpdate:expandedNames': update, 'data-sample': 'collapse' },
            {
              default: () => h(NCollapseItem, { name: 'field', title: 'Field' }, { default: () => h('input') }),
              arrow: () => h('span', { 'data-sample': 'arrow' }, 'Arrow'),
            },
          ),
      }),
      {
        global: { stubs: { transition: false, 'transition-group': false } },
      },
    );
    expect(view.find('input').exists()).toBe(false);
    expanded.value = ['field'];
    await flushPromises();
    const input = view.get('input');
    await input.setValue('raw input');
    expanded.value = [];
    await flushPromises();
    expanded.value = ['field'];
    await flushPromises();
    expect(view.get('input').element).toBe(input.element);
    expect(view.get('input').element.value).toBe('raw input');
    expect(view.attributes('data-sample')).toBe('collapse');
    expect(view.get('[data-sample="arrow"]').text()).toBe('Arrow');
    await view.get('.n-collapse-item__header-main').trigger('click');
    expect(update).toHaveBeenLastCalledWith([]);
    view.unmount();
  });
});
