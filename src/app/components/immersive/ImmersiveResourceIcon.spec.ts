import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveResourceIcon from './ImmersiveResourceIcon.vue';
import checkmark from '@/assets/immersive/controls/checkmark.svg';
import locked from '@/assets/immersive/controls/checkmark-locked.svg';
import unlocked from '@/assets/immersive/controls/checkmark-unlocked.svg';
import sort from '@/assets/immersive/controls/sort-arrow.svg';
import info from '@/assets/immersive/controls/more-info.svg';

describe('tinted resource presentation', () => {
  it.each([
    ['checkmark', checkmark],
    ['checkmark_locked', locked],
    ['checkmark_unlocked', unlocked],
    ['sortIcon', sort],
    ['icon_more_info', info],
  ])('draws %s locally until media is available', async (fallback, asset) => {
    const own = mount(ImmersiveResourceIcon, { props: { source: '', color: '#aadeff', size: 20, label: 'Status', fallback } });
    const element = own.element;
    const fallbackStyle = own.attributes('style');
    expect((own.element as HTMLElement).style.maskImage).toBe('url(' + JSON.stringify(asset) + ')');
    await own.setProps({ source: 'ready.png' });
    expect(own.attributes('style')).toContain('ready.png');
    await own.setProps({ source: '' });
    expect(own.attributes('style')).toBe(fallbackStyle);
    expect(own.element).toBe(element);
    own.unmount();
  });
  it('reflects actual status and resource replacement without changing the target element', async () => {
    const own = mount(ImmersiveResourceIcon, { props: { source: 'check.png', color: '#ffd200', size: 20, label: '普通' } });
    const element = own.element;
    expect(own.attributes('aria-label')).toBe('普通');
    expect(own.attributes('style')).toContain('20px');
    await own.setProps({ source: 'locked.png', color: '#afafaf', label: '内置' });
    expect(own.element).toBe(element);
    expect(own.attributes('aria-label')).toBe('内置');
    expect(own.attributes('style')).toContain('locked.png');
    own.unmount();
  });
});
