import { describe, expect, it, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useImmersiveHover } from './use-immersive-hover';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function harness() {
  vi.useFakeTimers();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    },
  );
  let hover!: ReturnType<typeof useImmersiveHover<string>>;
  const own = mount(
    defineComponent({
      setup() {
        hover = useImmersiveHover(() => 400);
        return () =>
          h('div', [
            h(
              'button',
              { onFocus: (event: FocusEvent) => hover.show('one', event.currentTarget as HTMLElement, 'focus'), onMouseleave: hover.leave },
              'entry',
            ),
            hover.selected.value ? h('aside', { ref: hover.surface, tabindex: '-1' }, hover.selected.value) : null,
          ]);
      },
    }),
    { attachTo: document.body },
  );
  return { own, hover, disconnect };
}
describe('immersive hover ownership', () => {
  it('keeps a keyboard-owned detail while the pointer leaves its focused entry', async () => {
    const { own, hover } = harness();
    (own.find('button').element as HTMLElement).focus();
    await flushPromises();
    await own.find('button').trigger('mouseleave');
    vi.advanceTimersByTime(150);
    expect(hover.selected.value).toBe('one');
    hover.leave(new FocusEvent('focusout'));
    vi.advanceTimersByTime(100);
    expect(hover.selected.value).toBeNull();
    own.unmount();
  });
  it('keeps the same target across the entry, panel and focus transition', async () => {
    const { own, hover } = harness();
    const entry = own.find('button').element;
    hover.show('one', entry);
    await flushPromises();
    const panel = own.find('aside').element;
    hover.leave(new MouseEvent('mouseleave', { relatedTarget: panel }));
    vi.advanceTimersByTime(150);
    expect(own.find('aside').element).toBe(panel);
    hover.leave(new MouseEvent('mouseleave'));
    hover.keep();
    vi.advanceTimersByTime(150);
    expect(hover.selected.value).toBe('one');
    hover.leave(new FocusEvent('focusout', { relatedTarget: entry }));
    vi.advanceTimersByTime(150);
    expect(hover.selected.value).toBe('one');
    own.unmount();
  });
  it('closes, releases the anchor and returns focus without reopening on Esc', async () => {
    const { own, hover } = harness();
    hover.show('one', own.find('button').element);
    await flushPromises();
    (own.find('aside').element as HTMLElement).focus();
    hover.close(true);
    await flushPromises();
    expect(hover.selected.value).toBeNull();
    expect(hover.anchor.value).toBeNull();
    expect(document.activeElement).toBe(own.find('button').element);
    expect(own.find('aside').exists()).toBe(false);
    hover.show('one', own.find('button').element);
    expect(hover.selected.value).toBeNull();
    await own.find('button').trigger('mouseleave');
    hover.show('one', own.find('button').element);
    expect(hover.selected.value).toBe('one');
    own.unmount();
  });
  it('ends leaving and disposal waits within the owning hover', async () => {
    const { own, hover, disconnect } = harness();
    hover.show('one', own.find('button').element);
    hover.leave(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(100);
    expect(hover.selected.value).toBeNull();
    hover.show('two', own.find('button').element);
    hover.leave(new MouseEvent('mouseleave'));
    own.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
