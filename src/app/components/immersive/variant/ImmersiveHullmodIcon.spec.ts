import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveHullmodIcon from './ImmersiveHullmodIcon.vue';

describe('hullmod default graphic', () => {
  it.each([32, 34])('keeps its %i px size through missing, ready and replaced resources', async (size) => {
    const own = mount(ImmersiveHullmodIcon, {
      props: {
        sessionId: 's',
        resource: { source: 'mod', ownerKind: 'hullmods', ownerId: 'sample', key: 'icon', relPath: 'sample.png' },
        url: '',
        active: true,
        size,
        label: 'Sample',
      },
      global: {
        stubs: {
          ResourceThumbnail: { props: ['url', 'width', 'height'], template: '<canvas :data-url="url" :width="width" :height="height" />' },
        },
      },
    });
    expect(own.find('img').attributes('width')).toBe(String(size));
    expect(own.find('img').attributes('src')).toContain('data:image/svg+xml');
    await own.setProps({ url: 'ready.png' });
    expect(own.find('canvas').attributes('data-url')).toBe('ready.png');
    expect(own.find('img').exists()).toBe(false);
    await own.setProps({ resource: null, url: '' });
    expect(own.find('img').attributes('width')).toBe(String(size));
    own.unmount();
  });
});
