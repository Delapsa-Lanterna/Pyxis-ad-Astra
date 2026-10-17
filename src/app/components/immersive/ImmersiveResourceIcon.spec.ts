import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveResourceIcon from './ImmersiveResourceIcon.vue';
import locked from '@/assets/immersive/controls/checkmark-locked.svg?raw';
import unlocked from '@/assets/immersive/controls/checkmark-unlocked.svg?raw';

describe('tinted resource presentation', () => {
  it('keeps the same outer lock body for both states', () => {
    const body = (svg: string) =>
      new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('path')!.getAttribute('d')!.split('Z')[0];
    expect(body(locked)).toBe(body(unlocked));
  });
  it.each(['checkmark', 'checkmark_locked', 'checkmark_unlocked', 'sortIcon', 'icon_more_info'])(
    'draws %s locally until media is available',
    async (fallback) => {
      const own = mount(ImmersiveResourceIcon, { props: { source: '', color: '#aadeff', size: 20, label: 'Status', fallback } });
      const element = own.element;
      const fallbackStyle = own.attributes('style');
      expect(fallbackStyle).toContain('data:image/svg+xml');
      await own.setProps({ source: 'ready.png' });
      expect(own.attributes('style')).toContain('ready.png');
      await own.setProps({ source: '' });
      expect(own.attributes('style')).toBe(fallbackStyle);
      expect(own.element).toBe(element);
      own.unmount();
    },
  );
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
