import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveGameFrame from './ImmersiveGameFrame.vue';

describe('immersive panel frame', () => {
  it('renders resource-independent content and preserves it through resizing', async () => {
    const wrapper = mount(ImmersiveGameFrame, { slots: { default: '<button>Content</button>' } });
    const content = wrapper.find('button').element;
    expect(wrapper.findAll('img, [aria-hidden=true]')).toHaveLength(0);
    await wrapper.setProps({ style: { width: '960px' } });
    expect(wrapper.find('button').element).toBe(content);
    wrapper.unmount();
  });
});
