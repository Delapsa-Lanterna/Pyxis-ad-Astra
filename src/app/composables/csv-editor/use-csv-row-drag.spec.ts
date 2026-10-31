import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCsvRowDrag } from './use-csv-row-drag';
import { createFieldInputs } from '@/shared/runtime/field-inputs';

const error = vi.hoisted(() => vi.fn());
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error }) }));
let wrapper: VueWrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const panel = shallowRef<HTMLElement | null>(null),
    disabled = ref(''),
    context = ref('one');
  const rowKeys = ref(Array.from({ length: 8 }, (_, index) => 'row-' + index));
  const inputs = createFieldInputs(ref('one')),
    move = vi.fn(),
    copy = vi.fn(),
    select = vi.fn(),
    scrolled = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0,
    captured = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let drag!: ReturnType<typeof useCsvRowDrag>;
  wrapper = mount(
    defineComponent({
      setup() {
        drag = useCsvRowDrag({
          panel,
          rowKeys,
          disabled: () => disabled.value,
          context: () => context.value,
          inputs,
          move,
          copy,
          select,
          scrolled,
        });
        return () => h('div', { ref: panel }, [h('input')]);
      },
    }),
    { attachTo: document.body },
  );
  Object.assign(panel.value!, {
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  });
  Object.defineProperty(panel.value!, 'clientHeight', { value: 120 });
  const event = (y: number, ctrlKey = false) => ({ button: 0, pointerId: 7, clientX: 10, clientY: y, ctrlKey }) as PointerEvent;
  const advance = (time: number) => {
    const [id, callback] = [...frames][0]!;
    frames.delete(id);
    callback(time);
  };
  return { drag, inputs, disabled, context, rowKeys, move, copy, select, scrolled, event, frames, advance };
}

describe('CSV row drag lifecycle', () => {
  it.each([false, true])('fixes the copy mode at pointer down with Ctrl=%s', async (ctrl) => {
    const { drag, move, copy, event } = fixture();
    drag.start('row-0', event(30, ctrl));
    await flushPromises();
    drag.onMove(event(95, !ctrl));
    drag.onUp(event(95, !ctrl));
    drag.onUp(event(95, !ctrl));
    expect(copy.mock.calls).toEqual(ctrl ? [['row-0', 3]] : []);
    expect(move.mock.calls).toEqual(ctrl ? [] : [['row-0', 2]]);
  });
  it.each([
    [25, 0],
    [40, 1],
    [215, 8],
  ])('copies at pointer y=%i to boundary %i', async (y, boundary) => {
    const { drag, copy, event } = fixture();
    drag.start('row-0', event(30, true));
    await flushPromises();
    drag.onMove(event(y));
    drag.onUp(event(y));
    expect(copy).toHaveBeenCalledExactlyOnceWith('row-0', boundary);
  });
  it.each(['threshold', 'escape', 'cancel', 'disabled', 'baseline', 'unmount'])('releases a copy on %s', async (boundary) => {
    const { drag, copy, disabled, context, event, frames } = fixture();
    drag.start('row-0', event(30, true));
    await flushPromises();
    drag.onMove(event(boundary === 'threshold' ? 32 : 95));
    if (boundary === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (boundary === 'cancel') drag.cancel();
    if (boundary === 'disabled') disabled.value = '搜索中';
    if (boundary === 'baseline') context.value = 'two';
    if (boundary === 'unmount') wrapper.unmount();
    drag.onUp(event(boundary === 'threshold' ? 32 : 95));
    expect(copy).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it('commits one drop after input acceptance and selects the same record', async () => {
    const { drag, move, select, event } = fixture();
    drag.start('row-0', event(30));
    await flushPromises();
    drag.onMove(event(34));
    expect(drag.dragging.value).toBe(true);
    drag.onMove(event(95));
    expect(move).not.toHaveBeenCalled();
    drag.onUp(event(95));
    expect(select).toHaveBeenCalledExactlyOnceWith('row-0');
    expect(move).toHaveBeenCalledExactlyOnceWith('row-0', 2);
    expect(drag.insertion.value).toBeNull();
  });
  it.each(['threshold', 'origin', 'escape', 'cancel', 'disabled', 'baseline', 'unmount'])('keeps the order on %s', async (boundary) => {
    const { drag, move, disabled, context, event, frames } = fixture();
    drag.start('row-0', event(30));
    await flushPromises();
    drag.onMove(event(boundary === 'threshold' ? 32 : 95));
    if (boundary === 'origin') drag.onMove(event(30));
    if (boundary === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (boundary === 'cancel') drag.cancel();
    if (boundary === 'disabled') disabled.value = '搜索中';
    if (boundary === 'baseline') context.value = 'two';
    if (boundary === 'unmount') wrapper.unmount();
    drag.onUp(event(boundary === 'origin' ? 30 : boundary === 'threshold' ? 32 : 95));
    expect(move).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it.each([false, true])('keeps invalid input and focus at their owner with Ctrl=%s', async (ctrl) => {
    const { drag, inputs, move, copy, select, event } = fixture();
    const dirty = ref(true),
      input = wrapper.get('input').element;
    inputs.register({ key: 'raw', label: 'Raw', dirty, commit: () => 'Incomplete', cancel: vi.fn(), focus: () => input.focus() });
    drag.start('row-0', event(30, ctrl));
    await flushPromises();
    drag.onMove(event(95));
    drag.onUp(event(95));
    expect(document.activeElement).toBe(input);
    expect(dirty.value).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
  it.each([false, true])('ends a short pointer action before delayed input finalization with Ctrl=%s', async (ctrl) => {
    const { drag, inputs, move, copy, event } = fixture();
    let finish!: () => void;
    inputs.registerFinalizer(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    drag.start('row-0', event(30, ctrl));
    drag.onMove(event(95));
    drag.onUp(event(95));
    finish();
    await flushPromises();
    expect(move).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });
  it.each([false, true])('scrolls at the edge, updates the insertion and releases the frame loop with Ctrl=%s', async (ctrl) => {
    const { drag, scrolled, event, advance, frames } = fixture();
    drag.start('row-0', event(30, ctrl));
    await flushPromises();
    drag.onMove(event(119));
    advance(10);
    advance(26);
    expect(scrolled).toHaveBeenCalled();
    expect(drag.insertion.value?.rowKey).toBeDefined();
    drag.cancel();
    expect(frames.size).toBe(0);
  });
  it('accepts an unloaded target identity at its drop position', async () => {
    const { drag, rowKeys, move, event } = fixture();
    rowKeys.value[2] = 'unloaded';
    drag.start('row-0', event(30));
    await flushPromises();
    drag.onMove(event(90));
    drag.onUp(event(90));
    expect(move).toHaveBeenCalledExactlyOnceWith('row-0', 2);
  });
});
