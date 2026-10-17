import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { NCollapseItem } from 'naive-ui/es/collapse';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import { focusFieldInput } from './focus-field-input';

describe('collapsed input focus', () => {
  it('opens the schema section through its semantic expansion control', async () => {
    const shown = ref(false);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h('section', { class: 'schema-section' }, [
            h(
              'button',
              {
                class: 'section-header',
                'aria-expanded': shown.value,
                onClick: () => {
                  shown.value = !shown.value;
                },
              },
              'Field',
            ),
            h('div', { style: { display: shown.value ? '' : 'none' } }, h('div', { class: 'section-fields' }, h('input'))),
          ]),
      }),
      { attachTo: document.body },
    );
    const input = view.get('input').element;
    await focusFieldInput(input);
    expect(shown.value).toBe(true);
    expect(document.activeElement).toBe(input);
    view.unmount();
  });
  it('opens a retained Spec group and focuses the existing input', async () => {
    const expanded = ref(['sample']);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(
            EditorCollapse,
            {
              expandedNames: expanded.value,
              'onUpdate:expandedNames': (names: string[]) => {
                expanded.value = names;
              },
            },
            { default: () => h(NCollapseItem, { name: 'sample', title: 'Field' }, { default: () => h('input') }) },
          ),
      }),
      { attachTo: document.body },
    );
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
