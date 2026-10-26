import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import type { RowData } from '@/shared/types';
import type { FileSchema } from '@/domain/schema/schema.types';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import SchemaFormRenderer from './SchemaFormRenderer.vue';
import { createPinia, setActivePinia } from 'pinia';
import { vi } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn() }) }));

const schema: FileSchema = {
  $schema: 'circinus-ad-astra/field-schema/v1',
  id: 'fixture',
  sections: [
    { id: 'main', label: '主要', fields: [{ key: 'name', type: 'string', label: '名称' }] },
    { id: 'extra-section', label: '次要', collapsed: true, fields: [{ key: 'level', type: 'integer', label: '等级' }] },
  ],
};

function mountForm(modelValue: RowData, allowExtraFields?: boolean) {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  return mount(SchemaFormRenderer, {
    props: { schema: { ...schema, allowExtraFields }, modelValue },
    global: {
      components: { NCollapse, NCollapseItem },
      stubs: {
        SchemaFieldRenderer: {
          name: 'SchemaFieldRenderer',
          props: ['field', 'value'],
          emits: ['update'],
          template: '<div class="field-stub" @click="$emit(\'update\', $event)" />',
        },
        SchemaValueInput: {
          name: 'SchemaValueInput',
          props: ['field', 'value'],
          emits: ['update'],
          template: '<div class="json-stub" />',
        },
      },
    },
  });
}

enableAutoUnmount(afterEach);

describe('SchemaFormRenderer', () => {
  it.each([undefined, false, true])('uses only the declaration %s to show an empty or populated extra section', async (allowed) => {
    const form = mountForm({}, allowed);
    expect(form.find('.json-stub').exists()).toBe(allowed === true);
    await form.setProps({ modelValue: { name: 'kept', custom: null } });
    expect(form.find('.json-stub').exists()).toBe(allowed === true);
    form.findComponent({ name: 'SchemaFieldRenderer' }).vm.$emit('update', { kind: 'set', value: 'updated' });
    await nextTick();
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'updated', custom: null }]);
  });
  it('mounts fields when their section first opens and retains them after closing', async () => {
    const form = mountForm({ name: 'a', level: 1 });
    expect(form.findAll('.schema-section')).toHaveLength(2);
    expect(form.findAll('.field-stub')).toHaveLength(1);
    await form.findAll('.n-collapse-item__header-main')[1]!.trigger('click');
    expect(form.findAll('.field-stub')).toHaveLength(2);
    const field = form.findAll('.field-stub')[1]!.element;
    await form.findAll('.n-collapse-item__header-main')[1]!.trigger('click');
    expect(form.findAll('.field-stub')[1]!.element).toBe(field);
    expect(form.find('.json-stub').exists()).toBe(false);
  });

  it('toggles section collapse on header clicks', async () => {
    const form = mountForm({});
    const headers = form.findAll('.n-collapse-item__header-main');
    expect(form.findAll('.n-collapse-item')[1]!.classes()).not.toContain('n-collapse-item--active');
    await headers[1]!.trigger('click');
    expect(form.findAll('.n-collapse-item')[1]!.classes()).toContain('n-collapse-item--active');
    await headers[1]!.trigger('click');
    expect(form.findAll('.n-collapse-item')[1]!.classes()).not.toContain('n-collapse-item--active');
  });

  it('writes field updates back into the model with dotted paths', async () => {
    const form = mountForm({ name: 'a' });
    const fields = form.findAllComponents({ name: 'SchemaFieldRenderer' });
    fields[0]!.vm.$emit('update', { kind: 'set', value: 'renamed' });
    await nextTick();
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'renamed' }]);
  });

  it('renders extra keys through the JSON editor and writes them back', async () => {
    const form = mountForm({ name: 'a', bonus: 5 }, true);
    const json = form.findComponent({ name: 'SchemaValueInput' });
    expect(json.exists()).toBe(true);
    expect(json.props('value')).toEqual({ bonus: 5 });
    expect(json.props('field').reservedKeys).toEqual(['name', 'level']);

    json.vm.$emit('update', { kind: 'set', value: { bonus: 7 } });
    await nextTick();
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ name: 'a', bonus: 7 }]);
  });

  it('projects underscore-prefixed business fields into the extra editor', () => {
    const form = mountForm({ name: 'a', _rowKey: 'business', nested: { _slot: 'weapon' } }, true);
    expect(form.findComponent({ name: 'SchemaValueInput' }).props('value')).toEqual({
      _rowKey: 'business',
      nested: { _slot: 'weapon' },
    });
  });
});
