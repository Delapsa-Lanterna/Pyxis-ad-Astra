import { nextTick, onUnmounted, watch, shallowReactive, type ComponentPublicInstance } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import type { ResourceRef } from '@/shared/types';
import { recordPerformance, performanceMonitorEnabled } from '@/shared/runtime/performance';
import { warningNotice } from '@/shared/lib/errors';
import { useThumbnailPreload } from './use-thumbnail-preload';
import { resourceThumbnailRequest } from './use-resource-thumbnail';
import { useLayoutFrame } from '@/shared/runtime/use-layout-frame';

interface RegisteredMedia {
  id: string;
  element: Element | null;
  resource: ResourceRef | null;
  visible: boolean;
}

export function useVisibleResourceMedia(args: {
  sessionId: () => string | null | undefined;
  surface: string;
  failureLabel: string;
  onFailures?: (resources: readonly ResourceRef[]) => void;
  thumbnailSize?: number;
}) {
  const feedback = useAppFeedback();
  const registered = new Map<string, RegisteredMedia>();
  const preload = useThumbnailPreload(
    args.surface,
    args.onFailures ??
      ((resources) => feedback.warning(warningNotice(args.failureLabel + '：' + resources.length, 'resource.read_failed', args.surface))),
  );
  const elementEntries = new Map<Element, RegisteredMedia>();
  const callbacks = new Map<string, (element: Element | ComponentPublicInstance | null) => void>();
  const visibleIds = shallowReactive(new Set<string>());
  let root: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let rootHeight = -1;
  let disposed = false;
  let firstFrameRequestId = 0;
  const scheduleResize = useLayoutFrame(rebuildObserverWhenHeightChanges);

  function setMediaRoot(element: Element | ComponentPublicInstance | null): void {
    const nextRoot = element instanceof HTMLElement ? element : null;
    if (root === nextRoot) return;
    root?.removeAttribute('data-media-viewport');
    resizeObserver?.disconnect();
    root = nextRoot;
    root?.setAttribute('data-media-viewport', '');
    rootHeight = -1;
    if (root) {
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(root);
    }
    rebuildObserver();
  }

  function mediaRef(id: string, resource: ResourceRef | null | undefined) {
    const current = registered.get(id) ?? { id, element: null, resource: null, visible: false };
    const changed = current.resource ? !resource || !sameResourceRef(current.resource, resource) : Boolean(resource);
    current.resource = resource ?? null;
    registered.set(id, current);
    if (changed && current.visible) prepareImages();
    let callback = callbacks.get(id);
    if (!callback) {
      callback = (element) => registerElement(id, element);
      callbacks.set(id, callback);
    }
    return callback;
  }

  function mediaSrc(resource: ResourceRef | null | undefined): string {
    return resource && args.sessionId() ? preload.url(args.sessionId()!, resource) : '';
  }

  async function recordListFirstFrame(startedAt: number, entities: number): Promise<void> {
    if (!performanceMonitorEnabled || startedAt <= 0) return;
    const requestId = ++firstFrameRequestId;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (disposed || requestId !== firstFrameRequestId) return;
    const observedImages = [...registered.values()].filter((entry) => entry.visible && entry.resource).length;
    recordPerformance('frontend.config.listFirstFrame', performance.now() - startedAt, {
      surface: args.surface,
      entities,
      observedImages,
    });
  }

  function registerElement(id: string, element: Element | ComponentPublicInstance | null): void {
    const entry = registered.get(id);
    if (!entry) return;
    const nextElement = element instanceof Element ? element : null;
    if (entry.element === nextElement) return;
    if (entry.element) {
      observer?.unobserve(entry.element);
      elementEntries.delete(entry.element);
    }
    entry.element = nextElement;
    entry.visible = false;
    visibleIds.delete(id);
    if (!visibleIds.size) preload.prepare(args.sessionId() ?? '', [], []);
    if (nextElement) {
      elementEntries.set(nextElement, entry);
      observer?.observe(nextElement);
    } else {
      registered.delete(id);
      callbacks.delete(id);
    }
  }

  function rebuildObserverWhenHeightChanges(): void {
    const nextHeight = root?.clientHeight ?? 0;
    if (nextHeight === rootHeight) return;
    rebuildObserver();
  }

  function rebuildObserver(): void {
    observer?.disconnect();
    observer = null;
    preload.prepare(args.sessionId() ?? '', [], []);
    visibleIds.clear();
    rootHeight = root?.clientHeight ?? 0;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(handleIntersections, {
      root,
      rootMargin: `${rootHeight}px 0px ${rootHeight}px 0px`,
      threshold: 0,
    });
    for (const entry of registered.values()) {
      entry.visible = false;
      if (entry.element) observer.observe(entry.element);
    }
  }

  function handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const observed of entries) {
      const entry = elementEntries.get(observed.target);
      if (!entry || entry.visible === observed.isIntersecting) continue;
      entry.visible = observed.isIntersecting;
      if (entry.visible) visibleIds.add(entry.id);
      else visibleIds.delete(entry.id);
    }
    prepareImages();
  }

  function prepareImages() {
    const session = args.sessionId();
    if (session && root) {
      const bounds = root.getBoundingClientRect(),
        active: ResourceRef[] = [],
        near: ResourceRef[] = [];
      for (const id of visibleIds) {
        const entry = registered.get(id)!;
        if (!entry.resource || !entry.element) continue;
        const item = entry.element.getBoundingClientRect();
        (item.bottom > bounds.top && item.top < bounds.bottom ? active : near).push(entry.resource);
      }
      const request = (resource: ResourceRef) =>
        resourceThumbnailRequest(session, resource, args.thumbnailSize ?? 32, args.thumbnailSize ?? 32);
      preload.prepare(session, active.map(request), near.map(request));
    }
  }

  watch(() => args.sessionId(), rebuildObserver);

  onUnmounted(() => {
    disposed = true;
    root?.removeAttribute('data-media-viewport');
    observer?.disconnect();
    resizeObserver?.disconnect();
    registered.clear();
    elementEntries.clear();
    callbacks.clear();
    visibleIds.clear();
  });

  return { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot, mediaVisible: (id: string) => visibleIds.has(id) };
}
