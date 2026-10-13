import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveText from './ImmersiveText.vue';
import FontText from '@/app/components/fonts/FontText.vue';
import { immersiveFontIds } from '@/domain/immersive/font-roles';

describe('immersive font role entry', () => {
  it.each(Object.entries(immersiveFontIds))('maps %s to actual identity %s', (role, id) => {
    const own = mount(ImmersiveText, {
      props: { font: role as keyof typeof immersiveFontIds, text: '舰船', block: true, inkAligned: true, outlined: true },
      global: { stubs: { FontText: { props: ['font', 'text', 'runs', 'block', 'inkAligned', 'outlined'], template: '<span />' } } },
    });
    expect(own.findComponent(FontText).props()).toMatchObject({ font: id, text: '舰船', block: true, inkAligned: true, outlined: true });
    expect(own.classes()).toContain('immersive-text');
    own.unmount();
  });

  it('passes color runs and consumer attributes to the same root', () => {
    const runs = [{ text: '75', color: '#ffd200' }];
    const own = mount(ImmersiveText, {
      props: { runs },
      attrs: { 'data-field': 'capacity', style: { color: '#dcdcdc' } },
      global: { stubs: { FontText: { props: ['font', 'runs'], template: '<span />' } } },
    });
    expect(own.findComponent(FontText).props('font')).toBe('insignia15LTaa');
    expect(own.findComponent(FontText).props('runs')).toEqual(runs);
    expect(own.attributes('data-field')).toBe('capacity');
    expect(own.element.style.color).toBe('rgb(220, 220, 220)');
    own.unmount();
  });
});
