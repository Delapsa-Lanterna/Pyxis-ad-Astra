import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, onUpdated, ref } from 'vue';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import SchemaCollectionInput from './SchemaCollectionInput.vue';
import SchemaFieldRenderer from './SchemaFieldRenderer.vue';
import { nInput, nButton } from '@/test/ui-stubs';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';

let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
const global = { components: { NCollapse, NCollapseItem }, stubs: { 'n-input': nInput, 'n-button': nButton } };
describe('retained collection rows', () => {
  it('renders only the changed row after the document supplies a cloned value', async () => {
    const value = ref({ first: 'A', second: 'B', third: 'C' });
    const rendered = new Map<string, number>();
    const Probe = defineComponent({
      props: { name: { type: String, required: true }, value: { type: String, required: true } },
      setup(props) {
        onUpdated(() => rendered.set(props.name, (rendered.get(props.name) ?? 0) + 1));
        return () => h('span', { class: 'value' }, String(props.value));
      },
    });
    wrapper = mount(
      {
        setup: () => () =>
          h(
            SchemaCollectionInput,
            {
              field: {
                key: 'file',
                label: 'File',
                type: 'object',
                allowExtraFields: true,
                valueSchema: { key: 'text', label: 'Text', type: 'string' },
              },
              value: value.value,
              inputKey: 'file',
              fieldPath: 'file',
            },
            {
              default: ({ row }: { row: { key: string; value: string } }) => {
                return h(Probe, { name: row.key, value: row.value });
              },
            },
          ),
      },
      { global },
    );
    rendered.clear();
    value.value = { first: 'A', second: 'changed', third: 'C' };
    await nextTick();
    expect([...rendered]).toEqual([['second', 1]]);
    expect(wrapper.findAll('.value').map((node) => node.text())).toEqual(['A', 'changed', 'C']);
  });
  it('mounts groups on demand, retains pending inputs when hidden and opens new groups', async () => {
    const value = ref<Record<string, unknown>>({ '组.一': { line: '001' }, _two: {} });
    const inputs = createFieldInputs();
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(SchemaFieldRenderer, {
              field: {
                key: 'file',
                label: 'File',
                type: 'object',
                presentation: 'groups',
                allowExtraFields: true,
                valueSchema: {
                  key: 'group',
                  label: 'Group',
                  type: 'object',
                  allowExtraFields: true,
                  valueSchema: { key: 'line', label: 'Text', type: 'text' },
                },
              },
              value: value.value,
              onUpdate: (update) => {
                if (update.kind === 'set') value.value = update.value as Record<string, unknown>;
              },
            });
        },
      },
      { global, attachTo: document.body },
    );
    expect(wrapper.findAll('textarea')).toHaveLength(0);
    const header = wrapper.findAll('.n-collapse-item__header-main')[0]!;
    await header.trigger('click');
    const text = wrapper.get('textarea');
    text.element.value = 'pending\n$sample';
    await text.trigger('input');
    await header.trigger('click');
    expect(wrapper.get('textarea').element).toBe(text.element);
    expect(inputs.dirty.value).toBe(true);
    await header.trigger('click');
    expect(wrapper.get('textarea').element.value).toBe('pending\n$sample');
    await inputs.commit();
    expect(value.value['组.一']).toEqual({ line: 'pending\n$sample' });
    await wrapper.findAll('button').at(-1)!.trigger('click');
    expect(wrapper.findAll('.n-collapse-item')[2]!.classes()).toContain('n-collapse-item--active');
    expect(wrapper.findAll('.n-collapse-item')[1]!.classes()).not.toContain('n-collapse-item--active');
  });
});
