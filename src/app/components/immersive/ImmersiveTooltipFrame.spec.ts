import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveTooltipFrame from './ImmersiveTooltipFrame.vue';

describe('original tooltip border resources', () => {
  it('accepts six border slices and keeps content stable through resource replacement', async () => {
    const own = mount(ImmersiveTooltipFrame, { props: { images: {} }, slots: { default: '<button>来源</button>' } });
    const content = own.find('button').element;
    expect(own.findAll('[aria-hidden=true]')).toHaveLength(0);
    await own.setProps({ images: { ui_border1b_w: 'left.png' } });
    expect(own.classes()).not.toContain('textured');
    const edges = ['e', 'e_bot', 'e_top', 'w', 'w_bot', 'w_top'];
    const images = Object.fromEntries(edges.map((edge) => ['ui_border1b_' + edge, edge + '.png']));
    await own.setProps({ images });
    expect(own.findAll('[aria-hidden=true]')).toHaveLength(6);
    expect(own.find('.immersive-tooltip-edge-w').attributes('style')).toContain('w.png');
    for (const edge of edges) {
      await own.setProps({ images: { ...images, ['ui_border1b_' + edge]: '' } });
      expect(own.classes()).not.toContain('textured');
      expect(own.findAll('[aria-hidden=true]')).toHaveLength(0);
    }
    await own.setProps({ images });
    expect(own.classes()).toContain('textured');
    expect(own.find('button').element).toBe(content);
    own.unmount();
  });
});
