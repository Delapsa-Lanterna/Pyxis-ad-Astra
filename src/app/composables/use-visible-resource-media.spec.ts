import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { useVisibleResourceMedia } from './use-visible-resource-media';
import type { ResourceRef } from '@/shared/types';
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('./use-app-feedback', () => ({ useAppFeedback: () => ({ warning: vi.fn(), error: vi.fn() }) }));
vi.mock('./use-thumbnail-preload', () => ({ useThumbnailPreload: () => ({ prepare: mocks.prepare, url: () => '' }) }));
vi.mock('./use-resource-thumbnail', () => ({
  resourceThumbnailRequest: (session: string, resource: ResourceRef, width: number, height: number) => ({
    key: session + '/' + resource.relPath,
    sessionId: session,
    resources: [resource],
    width,
    height,
  }),
}));
vi.mock('@/shared/runtime/performance', () => ({ recordPerformance: vi.fn() }));
class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    TestIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  trigger(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  TestIntersectionObserver.instances = [];
  TestResizeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(240);
});
it('uses one viewport of advance space and keeps repeated DOM registrations stable', () => {
  const wrapper = mountHarness(),
    observer = activeObserver();
  expect(observer.options?.root).toBe(wrapper.get('[data-root]').element);
  expect(observer.options?.rootMargin).toBe('240px 0px 240px 0px');
  observer.trigger(wrapper.findAll('[data-row]').map((row) => ({ target: row.element, isIntersecting: true })));
  const prepared = mocks.prepare.mock.lastCall!;
  expect(prepared[1].length + prepared[2].length).toBe(2);
  expect([...prepared[1], ...prepared[2]].flatMap((request) => request.resources)).toEqual([resource(1), resource(2)]);
  const count = mocks.prepare.mock.calls.length;
  observer.trigger([{ target: wrapper.findAll('[data-row]')[0]!.element, isIntersecting: true }]);
  expect(mocks.prepare).toHaveBeenCalledTimes(count + 1);
  wrapper.unmount();
  expect(observer.disconnected).toBe(true);
});
it('rebuilds resized roots and clears old range requests on session changes', async () => {
  const wrapper = mountHarness(),
    first = activeObserver();
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  TestResizeObserver.instances.at(-1)!.trigger();
  expect(first.disconnected).toBe(true);
  expect(activeObserver().options?.rootMargin).toBe('480px 0px 480px 0px');
  await wrapper.setProps({ session: 'session-b' });
  expect(mocks.prepare.mock.lastCall).toEqual(['session-b', [], []]);
  wrapper.unmount();
});
function mountHarness(onFailures?: (resources: readonly ResourceRef[]) => void) {
  return mount(
    defineComponent({
      props: { session: { type: String, default: 'session-a' } },
      setup(props) {
        const media = useVisibleResourceMedia({
          sessionId: () => props.session,
          surface: 'test-list',
          failureLabel: '读取失败',
          onFailures,
        });
        return () =>
          h('div', { ref: media.setMediaRoot, 'data-root': '' }, [
            h('div', { ref: media.mediaRef('row-1', resource(1)), 'data-row': '1' }),
            h('div', { ref: media.mediaRef('row-2', resource(2)), 'data-row': '2' }),
            h('span', { 'data-src': media.mediaSrc(resource(1)) }),
          ]);
      },
    }),
  );
}

function activeObserver(): TestIntersectionObserver {
  return TestIntersectionObserver.instances[TestIntersectionObserver.instances.length - 1]!;
}

function resource(index: number): ResourceRef {
  return JSON.parse(
    `{"source":"mod","relPath":"graphics/test/${index}.png","ownerKind":"ship","ownerId":"ship-${index}","key":"sprite"}`,
  ) as ResourceRef;
}
