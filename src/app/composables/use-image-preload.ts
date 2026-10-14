import { onScopeDispose } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { useResourceMediaRegistry } from './use-resource-media-registry';
import { useQueryReadOwner } from './use-query-read-owner';
import { windowImageCache } from './use-window-image-cache';
import { useAppFeedback } from './use-app-feedback';
import { waitForRead } from '@/shared/runtime/read-request';
import { warningNotice } from '@/shared/lib/errors';

export function useImagePreload(surface: string, sharedMedia?: ReturnType<typeof useResourceMediaRegistry>) {
  const feedback = useAppFeedback(),
    cache = windowImageCache(),
    reads = useQueryReadOwner();
  const media =
    sharedMedia ??
    useResourceMediaRegistry({
      surface,
      onError: feedback.error,
      onFailures: (resources) => feedback.warning(warningNotice('图片读取失败：' + resources.length, 'resource.read_failed', surface)),
    });
  const active = new Map<string, { revision: number; release: () => void }>();
  const nearCollections = new Set<string>();
  let generation = 0;
  let previous = '';
  function prepare(sessionId: string, visible: readonly ResourceRef[], near: readonly ResourceRef[]) {
    const signature = JSON.stringify([
      sessionId,
      visible.map((resource) => [cache.key(sessionId, resource), cache.revision(sessionId, resource)]),
      near.map((resource) => [cache.key(sessionId, resource), cache.revision(sessionId, resource)]),
    ]);
    if (signature === previous) return;
    previous = signature;
    reads.revoke('consumer', 'preload');
    const current = ++generation,
      identity = { sessionId, current };
    for (const id of nearCollections) void media.releaseCollection(id);
    nearCollections.clear();
    const visibleMap = new Map(visible.map((resource) => [cache.key(sessionId, resource), resource]));
    for (const [key, entry] of active)
      if (!visibleMap.has(key) || entry.revision !== cache.revision(sessionId, visibleMap.get(key)!)) {
        entry.release();
        active.delete(key);
      }
    const ready = visible.every((resource) => cache.peek(sessionId, resource)) && near.every((resource) => cache.peek(sessionId, resource));
    if (ready) {
      for (const [key, resource] of visibleMap) {
        if (active.has(key)) continue;
        const image = cache.acquire(sessionId, resource, '');
        active.set(key, { revision: cache.revision(sessionId, resource), release: image.release });
      }
      void media.releaseCollection('visible');
      return;
    }
    void reads.consume(
      'preload',
      identity,
      async (signal) => {
        await media.replaceCollection(sessionId, 'visible', visible);
        if (signal.aborted) return;
        const waiting: Promise<HTMLImageElement>[] = [];
        for (const [key, resource] of visibleMap) {
          if (active.has(key)) continue;
          const url = media.dataUrl(sessionId, resource);
          if (!url) continue;
          const image = cache.acquire(sessionId, resource, url);
          const entry = { revision: cache.revision(sessionId, resource), release: image.release };
          active.set(key, entry);
          waiting.push(
            image.promise.catch((error) => {
              if (active.get(key) === entry) {
                entry.release();
                active.delete(key);
              }
              throw error;
            }),
          );
        }
        try {
          await waitForRead(Promise.all(waiting), identity, signal);
        } catch (error) {
          if (current === generation) {
            for (const [key, entry] of active) {
              if (!visibleMap.has(key)) continue;
              entry.release();
              active.delete(key);
            }
            void media.releaseCollection('visible');
          }
          throw error;
        }
        const queue = [...new Map(near.map((resource) => [cache.key(sessionId, resource), resource])).values()].filter(
          (resource) => !visibleMap.has(cache.key(sessionId, resource)) && !cache.peek(sessionId, resource),
        );
        await Promise.all(
          queue.map((resource, index) =>
            cache.preload(async () => {
              const id = 'near/' + current + '/' + index;
              nearCollections.add(id);
              try {
                await media.replaceCollection(sessionId, id, [resource]);
                if (signal.aborted) return;
                const url = media.dataUrl(sessionId, resource);
                if (url) {
                  const image = cache.acquire(sessionId, resource, url);
                  try {
                    await waitForRead(image.promise, identity, signal);
                  } finally {
                    image.release();
                  }
                }
              } finally {
                await media.releaseCollection(id);
                nearCollections.delete(id);
              }
            }, signal),
          ),
        );
      },
      {
        ready: () => {},
        error: (error) => {
          previous = '';
          feedback.error(error);
        },
      },
    );
  }
  onScopeDispose(() => {
    generation++;
    for (const id of nearCollections) void media.releaseCollection(id);
    for (const entry of active.values()) entry.release();
    active.clear();
  });
  return { prepare, url: (sessionId: string, resource: ResourceRef) => media.dataUrl(sessionId, resource) ?? '' };
}
