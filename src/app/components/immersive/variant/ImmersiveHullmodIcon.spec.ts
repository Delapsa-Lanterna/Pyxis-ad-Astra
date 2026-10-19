import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveHullmodIcon from './ImmersiveHullmodIcon.vue';

describe('hullmod default graphic', () => {
  it.each([32, 34])('keeps its %i px size through missing, ready and replaced resources', async (size) => {
    const own = mount(ImmersiveHullmodIcon, {
      props: {
        sessionId: 's',
        resource: null,
        active: true,
        size,
        label: 'Sample',
      },
      global: {
        stubs: {
          ResourceThumbnail: {
            props: ['resource', 'width', 'height'],
            template: '<canvas :data-resource="resource.relPath" :width="width" :height="height" />',
          },
        },
      },
    });
    expect(own.find('img').attributes('width')).toBe(String(size));
    expect(own.find('img').attributes('src')).toContain('data:image/svg+xml');
    await own.setProps({
      resource: { source: 'mod', ownerKind: 'hullmods', ownerId: 'sample', key: 'icon', relPath: 'sample.png' },
    });
    expect(own.find('canvas').attributes('data-resource')).toBe('sample.png');
    expect(own.find('img').exists()).toBe(false);
    await own.setProps({ resource: null });
    expect(own.find('img').attributes('width')).toBe(String(size));
    own.unmount();
  });
});
