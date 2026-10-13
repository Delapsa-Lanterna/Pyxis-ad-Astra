import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveGameFrame from './ImmersiveGameFrame.vue';

describe('original game frame', () => {
  it('accepts eight resource slices while preserving content through resource replacement', async () => {
    const wrapper = mount(ImmersiveGameFrame, { props: { images: {} }, slots: { default: '<button>内容</button>' } });
    const content = wrapper.find('button').element;
    expect(wrapper.findAll('[aria-hidden=true]')).toHaveLength(8);
    await wrapper.setProps({ images: { ui_border1_top_left: 'frame.png' } });
    expect(wrapper.find('.immersive-game-frame-top_left').attributes('style')).toContain('frame.png');
    expect(wrapper.find('button').element).toBe(content);
    wrapper.unmount();
  });
});
