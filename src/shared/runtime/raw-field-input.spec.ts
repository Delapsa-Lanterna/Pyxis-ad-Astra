import { mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createFieldInputs, provideFieldInputs } from './field-inputs';
import { useRawFieldInput } from './raw-field-input';

describe('raw input acceptance', () => {
  it.each([false, true])('accepts before a recursive field action, forced=%s', async (forced) => {
    const inputs = createFieldInputs();
    const missing = ref(forced);
    const apply = vi.fn(() => {
      void inputs.commit();
    });
    let input!: ReturnType<typeof useRawFieldInput<string>>;
    const child = {
      setup() {
        input = useRawFieldInput({
          key: 'fixture',
          label: 'Fixture',
          text: () => '',
          convert: (value) => ({ kind: 'value', value }),
          apply,
          focus: () => {},
          forceCommit: () => missing.value,
        });
        return () => h('div');
      },
    };
    const wrapper = mount({
      setup() {
        provideFieldInputs(inputs);
        return () => h(child);
      },
    });
    if (!forced) input.update('updated');
    await inputs.commit();
    await inputs.commit();
    expect(apply).toHaveBeenCalledOnce();
    expect(input.dirty.value).toBe(false);
    missing.value = false;
    missing.value = true;
    if (forced) expect(input.dirty.value).toBe(true);
    input.update('pending');
    missing.value = false;
    expect(input.dirty.value).toBe(true);
    input.cancel();
    expect(input.dirty.value).toBe(false);
    wrapper.unmount();
  });

  it('retains rejected text and accepts its correction once', async () => {
    const inputs = createFieldInputs(),
      apply = vi.fn(),
      focus = vi.fn();
    let input!: ReturnType<typeof useRawFieldInput<string>>;
    const child = {
      setup() {
        input = useRawFieldInput({
          key: 'fixture',
          label: 'Fixture',
          text: () => 'base',
          convert: (value) => (value === 'bad' ? { kind: 'error', message: 'Invalid' } : { kind: 'value', value }),
          apply,
          focus,
        });
        return () => h('div');
      },
    };
    const wrapper = mount({
      setup() {
        provideFieldInputs(inputs);
        return () => h(child);
      },
    });
    input.update('bad');
    await expect(inputs.commit()).rejects.toThrow('Invalid');
    expect(input.raw.value).toBe('bad');
    expect(input.dirty.value).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    input.update('corrected');
    await inputs.commit();
    input.commit();
    expect(apply).toHaveBeenCalledOnce();
    expect(input.invalid.value).toBe(false);
    wrapper.unmount();
  });
});
