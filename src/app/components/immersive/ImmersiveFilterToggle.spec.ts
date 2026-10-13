import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveFilterToggle from './ImmersiveFilterToggle.vue';

describe('shared original checkbox rectangle', () => {
  it('renders original color blending and exposes keyboard checkbox state', async () => {
    const wrapper = mount(ImmersiveFilterToggle, {
      props: { text: '能量', label: '能量', checked: true, color: '#46c8ff', font: 'filter' },
      global: { stubs: { ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' } } },
    });
    expect(wrapper.attributes('role')).toBe('checkbox');
    expect(wrapper.attributes('aria-checked')).toBe('true');
    expect(wrapper.element.style.color).toBe('rgb(135, 219, 255)');
    expect(wrapper.element.style.backgroundColor).toBe('rgba(28, 80, 102, 0.686)');
    await wrapper.trigger('click');
    expect(wrapper.emitted('toggle')).toHaveLength(1);
    await wrapper.setProps({ checked: false });
    expect(wrapper.attributes('aria-checked')).toBe('false');
    wrapper.unmount();
  });
});
