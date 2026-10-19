import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { h, nextTick, ref, shallowReactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRetainedList } from './retained-list';
interface Item {
  id: string;
  value: string;
}
let wrapper: VueWrapper,
  time = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  frames.clear();
  time = 0;
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush() {
  while (frames.size) {
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback((time += 16));
    await flushPromises();
  }
  await nextTick();
}
function fixture(maxBatchSize = Infinity) {
  const keys = ref(Array.from({ length: 200 }, (_, index) => String(index)));
  const records = shallowReactive(new Map(keys.value.map((id) => [id, shallowReactive({ id, value: id })])));
  let list!: ReturnType<typeof useRetainedList<Item>>;
  wrapper = mount(
    {
      setup() {
        list = useRetainedList(
          () => keys.value,
          (key) => records.get(key),
          (item) => item.id,
          24,
          maxBatchSize,
        );
        return () =>
          h(
            'section',
            list.entries.value.map((view) =>
              view.kind === 'gap'
                ? h('div', { key: view.key })
                : h('input', {
                    key: view.key,
                    'data-id': view.item.id,
                    style: view.hidden ? 'display:none' : undefined,
                    value: view.item.value,
                    onVnodeMounted: () => {
                      time++;
                    },
                    onInput: (event: Event) => {
                      view.item.value = (event.target as HTMLInputElement).value;
                    },
                  }),
            ),
          );
      },
    },
    { attachTo: document.body },
  );
  const scroll = (index: number) => list.setViewportMetrics({ clientHeight: 120, scrollTop: index * 24 });
  return { keys, records, list, scroll };
}
describe('retained list lifecycle', () => {
  it('yields between bounded updates and completes its requested viewport', async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const own = fixture(4);
    own.list.setViewportMetrics({ clientHeight: 720, scrollTop: 0 });
    const [id, callback] = [...frames][0]!;
    frames.delete(id);
    callback((time += 16));
    await flushPromises();
    expect(wrapper.findAll('input').length).toBeGreaterThan(0);
    expect(wrapper.findAll('input').length).toBeLessThanOrEqual(4);
    expect(frames.size).toBeGreaterThan(0);
    await flush();
    expect(wrapper.findAll('input')).toHaveLength(60);
  });
  it('mounts a nearby first visit and retains its nodes, input and focus across a round trip', async () => {
    const own = fixture();
    own.scroll(0);
    await flush();
    const first = wrapper.get<HTMLInputElement>('[data-id="0"]');
    first.element.focus();
    await first.setValue('original input');
    own.scroll(100);
    await flush();
    expect(wrapper.get('[data-id="0"]').element).toBe(first.element);
    expect(document.activeElement).toBe(first.element);
    own.scroll(0);
    await flush();
    expect(wrapper.get<HTMLInputElement>('[data-id="0"]').element.value).toBe('original input');
    expect(own.list.entries.value.filter((entry) => entry.kind === 'item').length).toBeLessThan(40);
  });
  it('prepares the last requested range when the viewport jumps before mounting', async () => {
    const own = fixture();
    own.scroll(0);
    own.scroll(100);
    own.scroll(180);
    await flush();
    expect(wrapper.find('[data-id="180"]').exists()).toBe(true);
    expect(wrapper.find('[data-id="0"]').exists()).toBe(false);
    expect(wrapper.find('[data-id="100"]').exists()).toBe(false);
  });
  it('mounts a record when its identity resolves after the viewport request', async () => {
    const own = fixture();
    own.records.delete('0');
    own.scroll(0);
    await flush();
    expect(wrapper.find('[data-id="0"]').exists()).toBe(false);
    own.records.set('0', shallowReactive({ id: '0', value: 'Ready' }));
    await flush();
    expect(wrapper.get<HTMLInputElement>('[data-id="0"]').element.value).toBe('Ready');
  });
  it('retains filtered nodes and restores their same instances', async () => {
    const own = fixture();
    own.scroll(0);
    await flush();
    const first = wrapper.get('[data-id="0"]').element;
    const keys = [...own.keys.value];
    own.keys.value = ['100'];
    await flush();
    expect(wrapper.get('[data-id="0"]').isVisible()).toBe(false);
    own.keys.value = keys;
    await flush();
    expect(wrapper.get('[data-id="0"]').element).toBe(first);
    expect(wrapper.get('[data-id="0"]').isVisible()).toBe(true);
  });
  it('preserves the rendered identity when a temporary record receives its saved key', async () => {
    const own = fixture();
    own.scroll(0);
    await flush();
    const first = wrapper.get('[data-id="0"]').element,
      record = own.records.get('0')!;
    own.records.delete('0');
    record.id = 'saved';
    own.records.set('saved', record);
    own.keys.value[0] = 'saved';
    await flush();
    expect(wrapper.get('[data-id="saved"]').element).toBe(first);
    expect(wrapper.findAll('[data-id="saved"]')).toHaveLength(1);
  });
  it('ensures a keyboard target before it receives focus', async () => {
    const own = fixture();
    await own.list.ensure(199);
    const last = wrapper.get<HTMLInputElement>('[data-id="199"]');
    last.element.focus();
    expect(document.activeElement).toBe(last.element);
  });
  it('releases pending mounting and activity when its owner unmounts', async () => {
    const own = fixture();
    own.scroll(100);
    wrapper.unmount();
    await flush();
    expect(frames.size).toBe(0);
    expect(own.list.activeItems.value).toEqual([]);
  });
});
