import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImmersiveFallbackIcon from './ImmersiveFallbackIcon.vue';
import kinetic from '@/assets/immersive/damage/kinetic.svg';
import explosive from '@/assets/immersive/damage/high-explosive.svg';
import fragmentation from '@/assets/immersive/damage/fragmentation.svg';
import energy from '@/assets/immersive/damage/energy.svg';
import other from '@/assets/immersive/damage/other.svg';
import hullmod from '@/assets/immersive/icons/generic-hullmod.svg';
import fighter from '@/assets/immersive/icons/fighter-blank.svg';

describe('local immersive graphics', () => {
  it.each([
    ['KINETIC', kinetic],
    ['HIGH_EXPLOSIVE', explosive],
    ['FRAGMENTATION', fragmentation],
    ['ENERGY', energy],
    ['OTHER', other],
    ['hullmod', hullmod],
    ['fighter', fighter],
  ])('renders the matching asset for %s and follows prop changes', async (kind, asset) => {
    const own = mount(ImmersiveFallbackIcon, { props: { kind, size: 80, label: 'Sample' } });
    expect(own.attributes('src')).toBe(asset);
    expect(own.attributes('width')).toBe('80');
    expect(own.attributes('height')).toBe('80');
    expect(own.attributes('alt')).toBe('Sample');
    const element = own.element;
    await own.setProps({ kind: 'fighter', size: 32, label: 'Deck' });
    expect(own.attributes()).toMatchObject({ src: fighter, width: '32', height: '32', alt: 'Deck' });
    expect(own.element).toBe(element);
    own.unmount();
  });
});
