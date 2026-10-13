import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ImmersiveResourceIcon from './ImmersiveResourceIcon.vue';

describe('tinted resource presentation', () => {
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
