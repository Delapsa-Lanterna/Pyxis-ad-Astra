import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { installCanvas2DStub } from '@/test/unit/canvas-stub';
import ImmersiveFilterGroup from './ImmersiveFilterGroup.vue';
beforeEach(() => {
  installCanvas2DStub();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
describe('original rectangular multi-select', () => {
  it('exposes counted checkbox semantics and sends normal or additive choices to its owner', async () => {
    const wrapper = mount(ImmersiveFilterGroup, {
      props: {
        options: [
          { value: 'Common', label: 'Common', count: 2 },
          { value: 'High Tech', label: 'High Tech', count: 1 },
        ],
        label: '全部设计类型',
        total: 3,
        modelValue: null,
      },
      global: { stubs: { ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' } } },
    });
    const checks = wrapper.findAll('[role=checkbox]');
    expect(checks[0]!.text()).toBe('全部设计类型 (3)');
    expect(checks.every((value) => value.attributes('aria-checked') === 'true')).toBe(true);
    await checks[2]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([['High Tech']]);
    await wrapper.setProps({ modelValue: ['High Tech'] });
    await checks[1]!.trigger('click', { ctrlKey: true });
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([null]);
    wrapper.unmount();
  });
});
