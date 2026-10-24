import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import { focusFieldInput } from './focus-field-input';
import { installNaiveUi } from '@/app/naive-ui.runtime';

describe('collapsed input focus', () => {
  it('opens a retained Spec group and focuses the existing input', async () => {
    const expanded = ref<(string | number)[]>(['sample']);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(
            EditorCollapse,
            {
              expandedNames: expanded.value,
              'onUpdate:expandedNames': (names: (string | number)[]) => {
                expanded.value = names;
              },
            },
            { default: () => h(NCollapseItem, { name: 'sample', title: 'Field' }, { default: () => h('input') }) },
          ),
      }),
      { attachTo: document.body, global: { plugins: [installNaiveUi] } },
    );
    await flushPromises();
    const input = view.get('input').element;
    expanded.value = [];
    await flushPromises();
    await focusFieldInput(input);
    expect(expanded.value).toEqual(['sample']);
    expect(view.get('input').element).toBe(input);
    expect(document.activeElement).toBe(input);
    view.unmount();
  });
});
