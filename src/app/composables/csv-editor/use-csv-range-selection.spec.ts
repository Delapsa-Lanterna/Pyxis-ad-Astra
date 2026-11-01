import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCsvRangeSelection } from './use-csv-range-selection';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { csvDraftRow } from '@/test/fixtures/csv-row';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
let wrapper: VueWrapper;
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const panel = shallowRef<HTMLElement | null>(null),
    identity = ref('one');
  const rows = Array.from({ length: 8 }, (_, index) => csvDraftRow({ a: String(index), b: '' }, 'row-' + index));
  const model = {
    rowKeys: rows.map((row) => row.rowKey),
    rowsByKey: Object.fromEntries(rows.map((row) => [row.rowKey, row])),
    columns: ['a', 'b'].map((key) => ({ key, widthPx: 100, className: '', enumOptions: [], schema: null })),
    totalWidthPx: 200,
    sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
  };
  const inputs = createFieldInputs(),
    active = ref<{ rowKey: string; column: string } | null>({ rowKey: 'row-0', column: 'a' });
  const activate = vi.fn((rowKey: string | null, column: string | null) => {
      active.value = rowKey && column ? { rowKey, column } : null;
    }),
    scrolled = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0,
    captured = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let range!: ReturnType<typeof useCsvRangeSelection>;
  wrapper = mount(
    defineComponent({
      setup() {
        range = useCsvRangeSelection({
          model: () => model,
          panel,
          inputs,
          current: () => active.value,
          activate,
          context: () => identity.value,
          scrolled,
        });
        return () => h('div', { ref: panel }, [h('div', { 'data-row-key': 'row-0' }, [h('div', { 'data-column-key': 'a' })])]);
      },
    }),
    { attachTo: document.body },
  );
  const release = vi.fn(() => {
    captured = false;
  });
  Object.assign(panel.value!, {
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: release,
  });
  vi.spyOn(panel.value!, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 216,
    height: 120,
    right: 216,
    bottom: 120,
    toJSON() {},
  });
  const event = (x: number, y: number) =>
    ({
      button: 0,
      pointerId: 7,
      clientX: x,
      clientY: y,
      target: wrapper.get('[data-column-key]').element,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent;
  return { range, event, activate, release, frames, inputs, identity, scrolled };
}
describe('CSV range pointer lifecycle', () => {
  it('leaves short clicks without capture, input submission or activation', async () => {
    const { range, event, inputs, activate, release, frames } = fixture();
    const commit = vi.spyOn(inputs, 'commit');
    range.start(event(20, 30));
    await flushPromises();
    range.up(event(21, 31));
    expect(commit).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(range.consumeClick()).toBe(false);
  });
  it('selects one rectangle and releases capture and scrolling once at pointer up', async () => {
    const { range, event, activate, release, frames } = fixture();
    range.start(event(20, 30));
    await flushPromises();
    range.move(event(130, 90));
    await flushPromises();
    expect(range.bounds.value).toEqual({ top: 0, bottom: 2, left: 0, right: 1 });
    range.up(event(130, 90));
    expect(activate).toHaveBeenCalledExactlyOnceWith('row-0', 'a');
    expect(release).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(range.consumeClick()).toBe(true);
    expect(range.consumeClick()).toBe(false);
  });
  it.each(['cancel', 'context', 'unmount'])('releases the active drag on %s', async (boundary) => {
    const { range, event, identity, release, frames } = fixture();
    range.start(event(20, 30));
    await flushPromises();
    range.move(event(210, 119));
    if (boundary === 'cancel') range.cancel();
    if (boundary === 'context') identity.value = 'two';
    if (boundary === 'unmount') wrapper.unmount();
    expect(release).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
  it('ends a short gesture before delayed input acceptance', async () => {
    const { range, event, inputs, activate } = fixture();
    let finish!: () => void;
    inputs.registerFinalizer(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    range.start(event(20, 30));
    range.up(event(130, 90));
    finish();
    await flushPromises();
    expect(activate).not.toHaveBeenCalled();
  });
  it('scrolls at the edge while the pointer remains captured', async () => {
    const { range, event, frames, scrolled } = fixture();
    range.start(event(20, 30));
    await flushPromises();
    range.move(event(215, 119));
    await flushPromises();
    const [id, frame] = [...frames][0]!;
    frames.delete(id);
    frame(16);
    expect(scrolled).toHaveBeenCalledOnce();
    range.cancel();
    expect(frames.size).toBe(0);
  });
});
