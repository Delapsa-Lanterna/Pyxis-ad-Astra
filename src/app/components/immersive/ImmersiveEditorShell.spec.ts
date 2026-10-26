import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NButton, NSpin } from 'naive-ui';
import ImmersiveEditorShell from './ImmersiveEditorShell.vue';

const props = {
  label: '装配',
  objectId: 'sample',
  targetKey: 'sample',
  referenceChanging: false,
  dirty: true,
  saving: false,
  loading: true,
  error: '',
  ready: false,
  locked: false,
  externalNotice: '',
  canUndo: true,
  canRedo: false,
};
const mountShell = (overrides = {}) =>
  mount(ImmersiveEditorShell, {
    props: { ...props, ...overrides },
    global: { components: { NButton, NSpin } },
    slots: { default: defineComponent({ setup: () => () => h('input', { value: '1e' }) }) },
  });
afterEach(() => vi.useRealTimers());
describe('immersive loading overlay', () => {
  it.each(['舰船', '武器', '战机联队', '装配'])('keeps the initial %s frame during preparation', (label) => {
    const own = mountShell({ label, compact: label === '装配' });
    expect(own.get('header').text()).toBe(`${label}编辑器sample`);
    expect(own.find('.immersive-editor-placeholder.immersive-scene-grid').exists()).toBe(true);
    expect(own.get('.immersive-loading-overlay [role="status"]').text()).toBe(`正在准备${label}`);
    expect(own.findComponent(NSpin).exists()).toBe(true);
    expect(own.findAll('.immersive-loading-overlay button')).toHaveLength(0);
    own.unmount();
  });
  it('retains the component, raw input and scroll while loading, switching or failing', async () => {
    const own = mountShell({ ready: true, loading: false });
    const input = own.get('input').element;
    const main = own.get('main').element;
    main.scrollTop = 128;
    for (const state of [
      { loading: true },
      { loading: false, referenceChanging: true },
      { referenceChanging: false, error: 'Read failed' },
    ]) {
      await own.setProps(state);
      expect(own.get('input').element).toBe(input);
      expect(input.value).toBe('1e');
      expect(main.scrollTop).toBe(128);
      expect(own.get('main').attributes('inert')).toBeDefined();
      expect(own.get('.immersive-loading-overlay').attributes('inert')).toBeUndefined();
    }
    expect(own.findComponent(NSpin).exists()).toBe(false);
    expect(own.findAll('.immersive-loading-overlay button').map((button) => button.text())).toEqual(['重试']);
    await own.get('.immersive-loading-overlay button').trigger('click');
    expect(own.emitted('retry')).toHaveLength(1);
    await own.setProps({ error: '', loading: true });
    expect(own.findComponent(NSpin).exists()).toBe(true);
    await own.setProps({ loading: false });
    expect(own.find('.immersive-loading-overlay').exists()).toBe(false);
    expect(own.get('input').element).toBe(input);
    expect(own.get('main').attributes('inert')).toBe('false');
    own.unmount();
  });
  it('restarts the twelve second notice on retry and target changes and releases timers', async () => {
    vi.useFakeTimers();
    const own = mountShell();
    await vi.advanceTimersByTimeAsync(11999);
    expect(own.text()).not.toContain('准备时间较长');
    expect(own.emitted('slow')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(own.text()).toContain('准备时间较长，请继续等待');
    expect(own.emitted('slow')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12000);
    expect(own.emitted('slow')).toHaveLength(1);
    await own.setProps({ targetKey: 'next' });
    expect(own.text()).not.toContain('准备时间较长');
    await own.setProps({ loading: false, error: 'Failed' });
    expect(vi.getTimerCount()).toBe(0);
    await own.setProps({ loading: true, error: '' });
    await vi.advanceTimersByTimeAsync(12000);
    expect(own.text()).toContain('准备时间较长');
    expect(own.emitted('slow')).toHaveLength(2);
    await own.setProps({ loading: false, ready: true });
    expect(vi.getTimerCount()).toBe(0);
    await own.setProps({ loading: true });
    own.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
