import { onScopeDispose } from 'vue';
import { windowImageRuntime, type ThumbnailRequest } from './use-window-image-runtime';
import { resourceMediaDataUrl, subscribeResourceInvalidations } from '@/services/resource-media.service';
import type { ResourceRef } from '@/shared/types';
import { useAppFeedback } from './use-app-feedback';
import { createReadTicket, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';
import { warningNotice } from '@/shared/lib/errors';
export function useThumbnailPreload(surface: string, onFailures?: (resources: readonly ResourceRef[]) => void) {
  const runtime = windowImageRuntime(),
    feedback = useAppFeedback();
  const held = new Map<string, ReturnType<typeof runtime.acquireThumbnail>>();
  let disposed = false,
    previous = '';
  const reported = new Set<string>();
  let waiting: ReadTicket<PromiseSettledResult<HTMLCanvasElement>[]> | null = null;
  let range: { session: string; visible: readonly ThumbnailRequest[]; near: readonly ThumbnailRequest[] } | null = null;
  function prepare(_session: string, visible: readonly ThumbnailRequest[], near: readonly ThumbnailRequest[]) {
    range = { session: _session, visible, near };
    const signature = JSON.stringify([_session, visible.map((request) => request.key), near.map((request) => request.key)]);
    if (signature === previous) return;
    previous = signature;
    waiting?.invalidate('consumer');
    const current = new Map([...visible, ...near].map((request) => [request.key, request]));
    const visibleKeys = new Set(visible.map((request) => request.key));
    for (const [key, lease] of held)
      if (!current.has(key)) {
        lease.release();
        held.delete(key);
      }
    function acquire(request: ThumbnailRequest, priority: 'visible' | 'near', afterVisible?: Promise<void>) {
      const existing = held.get(request.key);
      if (existing) {
        if (priority !== 'visible') return existing;
      }
      const lease = runtime.acquireThumbnail(request, priority, afterVisible);
      held.set(request.key, lease);
      existing?.release();
      void lease.promise
        .then(() => {
          if (disposed || held.get(request.key) !== lease) return;
          const missing = runtime.thumbnailFailures(request.key).filter((resource) => {
            const key = runtime.key(request.sessionId, resource) + '/' + runtime.revision(request.sessionId, resource);
            if (reported.has(key)) return false;
            reported.add(key);
            return true;
          });
          if (missing.length) {
            if (onFailures) onFailures(missing);
            else feedback.warning(warningNotice('图片读取失败：' + missing.length, 'resource.read_failed', surface));
          }
        })
        .catch((error) => {
          if (disposed || held.get(request.key) !== lease) return;
          lease.release();
          held.delete(request.key);
          previous = '';
          if (!isReadInvalidated(error)) feedback.error(error, surface);
        });
      return lease;
    }
    const first = visible.map((request) => acquire(request, 'visible').promise);
    const afterVisible = Promise.allSettled(first).then(() => undefined);
    for (const request of near) if (!visibleKeys.has(request.key)) acquire(request, 'near', afterVisible);
    const ticket = (waiting = createReadTicket({ sessionId: _session, signature }, () =>
      Promise.allSettled([...held.values()].map((lease) => lease.promise)),
    ));
    const settled = () => {
      if (waiting === ticket) waiting = null;
    };
    void ticket.promise.then(settled, settled);
  }
  function recapture() {
    if (!range) return;
    const capture = (request: ThumbnailRequest) => request.capture?.() ?? request;
    previous = '';
    prepare(range.session, range.visible.map(capture), range.near.map(capture));
  }
  const stop = subscribeResourceInvalidations((event) => {
    if (event.sessionId !== range?.session) return;
    if (event.scope === 'session') prepare(event.sessionId, [], []);
    else recapture();
  });
  window.addEventListener('resize', recapture);
  onScopeDispose(() => {
    disposed = true;
    stop();
    window.removeEventListener('resize', recapture);
    waiting?.invalidate('consumer');
    for (const lease of held.values()) lease.release();
    held.clear();
  });
  return { prepare, url: (session: string, resource: ResourceRef) => resourceMediaDataUrl(session, resource) ?? '' };
}
