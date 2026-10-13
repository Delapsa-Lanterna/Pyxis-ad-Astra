import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveTooltipFrame from './ImmersiveTooltipFrame.vue';

describe('original tooltip border resources', () => {
  it('accepts six border slices and keeps content stable through resource replacement', async () => {
    const own = mount(ImmersiveTooltipFrame, { props: { images: {} }, slots: { default: '<button>来源</button>' } });
    const content = own.find('button').element;
    expect(own.findAll('[aria-hidden=true]')).toHaveLength(6);
    await own.setProps({ images: { ui_border1b_w: 'left.png' } });
    expect(own.find('.immersive-tooltip-edge-w').attributes('style')).toContain('left.png');
    expect(own.find('button').element).toBe(content);
    own.unmount();
  });
});
