import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveResourceIcon from './ImmersiveResourceIcon.vue';

describe('tinted resource presentation', () => {
  it.each(['checkmark', 'checkmark_locked', 'checkmark_unlocked', 'sortIcon'])(
    'draws %s locally until media is available',
    async (fallback) => {
      const own = mount(ImmersiveResourceIcon, { props: { source: '', color: '#aadeff', size: 20, label: 'Status', fallback } });
      const element = own.element;
      expect(own.find('svg path').attributes('d')).toBeTruthy();
      await own.setProps({ source: 'ready.png' });
      expect(own.find('svg').exists()).toBe(false);
      expect(own.attributes('style')).toContain('ready.png');
      await own.setProps({ source: '' });
      expect(own.find('svg path').exists()).toBe(true);
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
