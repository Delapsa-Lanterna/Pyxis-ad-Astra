import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useWindowShortcuts } from './use-window-shortcuts';
import { h, ref } from 'vue';
import { NModal } from 'naive-ui/es/modal';
import { NSelect } from 'naive-ui/es/select';
import { provideWindowCloseState } from './use-window-close-state';

const wrappers: VueWrapper[] = [];

function mountDispatch(handlers: Parameters<typeof useWindowShortcuts>[0]) {
  wrappers.push(
    mount({
      setup() {
        useWindowShortcuts(handlers);
        return () => null;
      },
    }),
  );
}

function press(key: string, options: KeyboardEventInit = {}, target?: Element) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  (target ?? window).dispatchEvent(event);
  return event;
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount();
  document.body.innerHTML = '';
});

describe('useWindowShortcuts plain keys', () => {
  it('dispatches plain key handlers and prevents the default behavior', () => {
    const alpha = vi.fn();
    mountDispatch({ keys: { a: alpha } });
    const event = press('a');
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves keys outside the active surface available to their focused controls', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { enter: handler }, keyScope: (event) => (event.target as HTMLElement).className === 'surface' });
    const outside = document.createElement('button'),
      inside = document.createElement('div');
    inside.className = 'surface';
    document.body.append(outside, inside);
    expect(press('Enter', {}, outside).defaultPrevented).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(press('Enter', {}, inside).defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });
  it('matches keys case-insensitively', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { t: handler } });
    press('T');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores plain keys inside editable targets', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('a', {}, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores plain keys with modifiers held', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    press('a', { ctrlKey: true });
    press('a', { altKey: true });
    press('a', { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when no handler matches', () => {
    const handler = vi.fn();
    mountDispatch({ keys: { a: handler } });
    const event = press('x');
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('useWindowShortcuts commands', () => {
  it('dispatches Mod save separately and ignores held-key repeats', () => {
    const save = vi.fn(),
      saveMod = vi.fn();
    mountDispatch({ commands: { save, saveMod } });
    press('s', { ctrlKey: true, shiftKey: true });
    press('s', { ctrlKey: true, shiftKey: true, repeat: true });
    press('s', { ctrlKey: true });
    expect(saveMod).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });
  it('pauses business shortcuts during a window close and restores them afterwards', () => {
    const save = vi.fn(),
      saveMod = vi.fn();
    const Child = {
      setup() {
        useWindowShortcuts({ commands: { save, saveMod } });
        return () => null;
      },
    };
    let closeState!: ReturnType<typeof provideWindowCloseState>;
    wrappers.push(
      mount({
        setup() {
          closeState = provideWindowCloseState({ requestClose: vi.fn(), createParticipant: vi.fn() });
          return () => h(Child);
        },
      }),
    );
    press('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledOnce();
    closeState.value = true;
    press('s', { ctrlKey: true });
    press('s', { ctrlKey: true, shiftKey: true });
    expect(saveMod).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    closeState.value = false;
    press('s', { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('routes escape to the close command', () => {
    const close = vi.fn();
    mountDispatch({ commands: { close } });
    const event = press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Escape to the input method during composition', () => {
    const close = vi.fn();
    mountDispatch({ commands: { close } });
    const input = document.createElement('input');
    document.body.append(input);
    expect(press('Escape', { isComposing: true }, input).defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(press('Escape', {}, input).defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([false, true])('lets a real dialog with autofocus=%s handle Escape before the window', async (autoFocus) => {
    const close = vi.fn();
    const show = ref(true);
    wrappers.push(
      mount(
        {
          setup() {
            useWindowShortcuts({ commands: { close } });
            return () =>
              h(NModal, {
                show: show.value,
                preset: 'dialog',
                autoFocus,
                title: 'Escape fixture',
                'onUpdate:show': (value: boolean) => {
                  show.value = value;
                },
              });
          },
        },
        { attachTo: document.body },
      ),
    );
    await flushPromises();
    const modal = document.querySelector<HTMLElement>('.n-dialog')!;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    await flushPromises();
    expect(show.value).toBe(false);
    expect(close).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(modal.style.display).toBe('none'));
    press('Escape');
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes a real select menu before allowing Escape to close the window', async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
    onTestFinished(() => {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollTo', previous);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    });
    const close = vi.fn();
    const show = ref(true);
    const wrapper = mount(
      {
        setup() {
          useWindowShortcuts({ commands: { close } });
          return () =>
            h(NSelect, {
              virtualScroll: false,
              show: show.value,
              options: [{ label: 'First', value: 'first' }],
              'onUpdate:show': (value: boolean) => {
                show.value = value;
              },
            });
        },
      },
      { attachTo: document.body },
    );
    wrappers.push(wrapper);
    await flushPromises();
    const selection = wrapper.get('.n-base-selection');
    await selection.trigger('keydown', { key: 'Escape', code: 'Escape' });
    await flushPromises();
    expect(show.value).toBe(false);
    expect(close).not.toHaveBeenCalled();
    await selection.trigger('keydown', { key: 'Escape', code: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('routes ctrl+s to save even inside editable targets', () => {
    const save = vi.fn();
    mountDispatch({ commands: { save } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('s', { ctrlKey: true }, input);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps undo inside editable targets only with undoRedoInEditable', () => {
    const undo = vi.fn();
    mountDispatch({ commands: { undo }, undoRedoInEditable: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('z', { ctrlKey: true }, input);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('skips undo inside editable targets by default and dispatches it outside', () => {
    const undo = vi.fn();
    mountDispatch({ commands: { undo } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('z', { ctrlKey: true }, input);
    expect(undo).not.toHaveBeenCalled();
    press('z', { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('leaves the event alone for commands without a registered handler', () => {
    mountDispatch({});
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(false);
  });
});
