import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NInputNumber } from 'naive-ui/es/input-number';
import { NInput } from 'naive-ui/es/input';
import { NSwitch } from 'naive-ui/es/switch';
import { NButton } from 'naive-ui/es/button';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import type { FieldSchema } from '@/domain/schema/schema.types';
import SchemaValueInput from './SchemaValueInput.vue';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(async () => 'discard') }) }));
let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});

function harness(field: Partial<FieldSchema> = {}, initial: unknown = 4) {
  const value = ref(initial);
  const inputs = createFieldInputs();
  wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(SchemaValueInput, {
            field: { key: 'count', label: 'Count', type: 'float', ...field },
            value: value.value,
            onUpdate: (update) => {
              value.value = update.kind === 'set' ? update.value : undefined;
            },
          });
      },
    },
    { global: { components: { NInputNumber, NInput, NSwitch, NButton } }, attachTo: document.body },
  );
  return { value, inputs };
}

describe('Schema numeric controls with real Naive UI', () => {
  it.each(['integer', 'float'] as const)('increments and decrements %s by one', async (type) => {
    const { value, inputs } = harness({ type });
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(value.value).toBe(5);
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(value.value).toBe(4);
    await inputs.commit();
    expect(inputs.dirty.value).toBe(false);
  });
  it('uses declared steps and limits and displays read-only controls', async () => {
    const { value } = harness({ step: 0.5, min: 4, max: 4.5 });
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(value.value).toBe(4.5);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(value.value).toBe(4.5);
    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(value.value).toBe(4);
  });
  it.each([false, true])('retains invalid raw text and applies required=%s when cleared', async (required) => {
    const { value, inputs } = harness({ required });
    await wrapper.get('input').setValue('1e');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(value.value).toBe(4);
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('1e');
    await wrapper.get('input').setValue('');
    if (required) await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    else {
      await inputs.commit();
      expect(value.value).toBeUndefined();
    }
  });
  it('hands pending input to the mode confirmation and commits plain numbers', async () => {
    const { value, inputs } = harness();
    await wrapper.get('input').setValue('1e');
    useSettingsStore().setEditMode('plain');
    await flushPromises();
    expect(wrapper.findComponent(NInput).exists()).toBe(true);
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('4');
    await wrapper.get('input').setValue('6.5');
    await inputs.commit();
    expect(value.value).toBe(6.5);
  });
  it('preserves game numeric strings through scalar submission', async () => {
    const { value, inputs } = harness({ numberFormat: 'starsector' }, '2.5f');
    await inputs.commit();
    expect(value.value).toBe('2.5f');
    await wrapper.get('input').setValue('3.5f');
    await inputs.commit();
    expect(value.value).toBe('3.5f');
  });
});
