import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveGameFrame from './ImmersiveGameFrame.vue';

describe('immersive panel frame', () => {
  it('uses complete border sets and preserves content and focus through fallback and resizing', async () => {
    const wrapper = mount(ImmersiveGameFrame, { attachTo: document.body, slots: { default: '<button>Content</button>' } });
    const content = wrapper.find('button').element;
    content.focus();
    expect(wrapper.findAll('img, [aria-hidden=true]')).toHaveLength(0);
    const edges = ['top_left', 'top', 'top_right', 'left', 'right', 'bot_left', 'bot', 'bot_right'];
    const images = Object.fromEntries(edges.map((edge) => ['ui_border1_' + edge, edge + '.png']));
    await wrapper.setProps({ images });
    expect(wrapper.classes()).toContain('textured');
    expect(wrapper.findAll('.immersive-game-border > span')).toHaveLength(8);
    for (const edge of edges) {
      await wrapper.setProps({ images: { ...images, ['ui_border1_' + edge]: '' } });
      expect(wrapper.classes()).not.toContain('textured');
      expect(wrapper.find('.immersive-game-border').exists()).toBe(false);
      expect(document.activeElement).toBe(content);
    }
    await wrapper.setProps({ style: { width: '960px' } });
    expect(wrapper.find('button').element).toBe(content);
    wrapper.unmount();
  });
});
