import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import NCollapseItem from './EditorCollapseItem.vue';
import EditorCollapse from './EditorCollapse.vue';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { waitForEditorCollapse } from './editor-collapse';

describe('EditorCollapse', () => {
  it.each(['reopen', 'unmount'])('settles pending hiding when its group changes through %s', async (boundary) => {
    const expanded = ref<(string | number)[]>(['field']);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(
            EditorCollapse,
            { expandedNames: expanded.value },
            {
              default: () => h(NCollapseItem, { name: 'field' }, { default: () => h('input') }),
            },
          ),
      }),
      { global: { stubs: { transition: false } } },
    );
    const input = view.get('input').element;
    expanded.value = [];
    await nextTick();
    let settled = false;
    const waiting = waitForEditorCollapse(view.element).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    if (boundary === 'reopen') expanded.value = ['field'];
    else view.unmount();
    await waiting;
    expect(settled).toBe(true);
    if (boundary === 'reopen') {
      expect(view.get('input').element).toBe(input);
      view.unmount();
    }
  });
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
        global: { plugins: [installNaiveUi], stubs: { transition: false, 'transition-group': false } },
      },
    );
    await flushPromises();
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
  it('keeps nested groups independent and restores their existing inputs', async () => {
    const outer = ref<(string | number)[]>(['field']);
    const inner = ref<(string | number)[]>([]);
    const view = mount(
      defineComponent({
        setup: () => () =>
          h(
            EditorCollapse,
            {
              expandedNames: outer.value,
              'onUpdate:expandedNames': (names: (string | number)[]) => {
                outer.value = names;
              },
            },
            {
              default: () =>
                h(
                  NCollapseItem,
                  { name: 'field', title: 'Outer' },
                  {
                    default: () =>
                      h(
                        EditorCollapse,
                        {
                          expandedNames: inner.value,
                          'onUpdate:expandedNames': (names: (string | number)[]) => {
                            inner.value = names;
                          },
                        },
                        { default: () => h(NCollapseItem, { name: 'field', title: 'Inner' }, { default: () => h('input') }) },
                      ),
                  },
                ),
            },
          ),
      }),
    );
    expect(view.find('input').exists()).toBe(false);
    await view.findAll('.n-collapse-item__header-main')[1]!.trigger('click');
    const input = view.get('input').element;
    await view.get('input').setValue('pending');
    await view.findAll('.n-collapse-item__header-main')[0]!.trigger('click');
    expect(inner.value).toEqual(['field']);
    await view.findAll('.n-collapse-item__header-main')[0]!.trigger('click');
    expect(view.get('input').element).toBe(input);
    expect(view.get('input').element.value).toBe('pending');
    view.unmount();
  });
  it('forwards shared slots and keeps header actions separate from toggling', async () => {
    const expanded = ref<(string | number)[]>([]);
    const action = vi.fn();
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
            {
              header: ({ collapsed }: { collapsed: boolean }) => h('span', { class: 'title' }, collapsed ? 'Closed' : 'Open'),
              'header-extra': () =>
                h(
                  'button',
                  {
                    onClick: (event: MouseEvent) => {
                      event.stopPropagation();
                      action();
                    },
                  },
                  'Action',
                ),
              arrow: () => h('span', { class: 'arrow' }, 'Arrow'),
              default: () => h(NCollapseItem, { name: 7 }, { default: () => h('input') }),
            },
          ),
      }),
    );
    expect(view.get('.title').text()).toBe('Closed');
    expect(view.get('.arrow').text()).toBe('Arrow');
    await view.get('button').trigger('click');
    expect(action).toHaveBeenCalledOnce();
    expect(expanded.value).toEqual([]);
    for (let i = 0; i < 5; i++) await view.get('.n-collapse-item__header-main').trigger('click');
    expect(expanded.value).toEqual([7]);
    expect(view.get('.title').text()).toBe('Open');
    expect(view.find('input').exists()).toBe(true);
    view.unmount();
  });
});
