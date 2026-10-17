import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentNavigation } from './use-content-navigation';

afterEach(() => vi.restoreAllMocks());
describe('content navigation', () => {
  it('keeps the wide-window choice through narrow-window navigation', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    let navigation!: ReturnType<typeof createContentNavigation>;
    const view = mount(
      defineComponent({
        setup() {
          navigation = createContentNavigation();
          return () => h('div');
        },
      }),
    );
    expect(navigation.expanded.value).toBe(true);
    await navigation.toggle();
    expect(navigation.expanded.value).toBe(false);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600);
    window.dispatchEvent(new Event('resize'));
    expect(navigation.state.narrow).toBe(true);
    await navigation.toggle();
    expect(navigation.expanded.value).toBe(true);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    window.dispatchEvent(new Event('resize'));
    expect(navigation.expanded.value).toBe(false);
    view.unmount();
  });
  it('moves focus into an open overlay and returns it to the entry on close', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600);
    let navigation!: ReturnType<typeof createContentNavigation>;
    const view = mount(
      defineComponent({
        setup() {
          navigation = createContentNavigation();
          return () =>
            h('div', [
              h('button', { 'aria-controls': 'mod-navigation-content' }, 'Open'),
              h('nav', { id: 'mod-navigation-content' }, [h('button', { class: 'mod-navigation-button active' }, 'Item')]),
            ]);
        },
      }),
      { attachTo: document.body },
    );
    await navigation.toggle();
    await flushPromises();
    expect(document.activeElement).toBe(view.get('.mod-navigation-button').element);
    navigation.close();
    expect(document.activeElement).toBe(view.get('[aria-controls]').element);
    view.unmount();
  });
  it('keeps state independent between window instances', async () => {
    let first!: ReturnType<typeof createContentNavigation>, second!: ReturnType<typeof createContentNavigation>;
    const view = mount(
      defineComponent({
        setup() {
          first = createContentNavigation();
          second = createContentNavigation();
          return () => h('div');
        },
      }),
    );
    await first.toggle();
    expect(first.expanded.value).not.toBe(second.expanded.value);
    view.unmount();
  });
});
