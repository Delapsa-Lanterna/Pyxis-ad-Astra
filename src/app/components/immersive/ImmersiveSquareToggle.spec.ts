import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveSquareToggle from './ImmersiveSquareToggle.vue';
import onImage from '@/assets/immersive/controls/toggle-on.svg';
import offImage from '@/assets/immersive/controls/toggle-off.svg';

describe('original square toggle', () => {
  it.each(['radio', 'checkbox'] as const)('exposes %s selection and forwards batch modifiers to its owner', async (role) => {
    const wrapper = mount(ImmersiveSquareToggle, {
      props: { role, checked: false, label: '第一组', title: '操作提示', onImage: 'on.png', offImage: 'off.png' },
    });
    expect(wrapper.attributes('aria-checked')).toBe('false');
    expect(wrapper.find('img').attributes('src')).toBe('off.png');
    await wrapper.trigger('click', { shiftKey: true });
    expect((wrapper.emitted('change')![0]![0] as MouseEvent).shiftKey).toBe(true);
    await wrapper.setProps({ checked: true });
    expect(wrapper.attributes('aria-checked')).toBe('true');
    expect(wrapper.find('img').attributes('src')).toBe('on.png');
    for (const missing of ['onImage', 'offImage']) {
      await wrapper.setProps({ onImage: 'on.png', offImage: 'off.png', [missing]: '' });
      expect(wrapper.classes()).toContain('fallback');
      expect(wrapper.find('img').attributes('src')).toBe(onImage);
      expect(wrapper.attributes('aria-checked')).toBe('true');
    }
    const selected = wrapper.find('img').element;
    await wrapper.setProps({ checked: false });
    expect(wrapper.find('img').attributes('src')).toBe(offImage);
    expect(wrapper.find('img').element).toBe(selected);
    await wrapper.setProps({ onImage: 'new-on.png', offImage: 'new-off.png', checked: false });
    expect(wrapper.classes()).not.toContain('fallback');
    expect(wrapper.find('img').attributes('src')).toBe('new-off.png');
    wrapper.unmount();
  });
});
