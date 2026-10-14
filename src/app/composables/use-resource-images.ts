import { onScopeDispose, ref, watch } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { windowImageCache } from './use-window-image-cache';
import { isReadInvalidated } from '@/shared/runtime/read-request';

export interface ResourceImageSource {
  resource: ResourceRef;
  url: string;
}
export function useResourceImages(
  session: () => string,
  source: () => readonly ResourceImageSource[],
  changed: () => void,
  failed: (error: unknown) => void,
  enabled: () => boolean = () => true,
) {
  const cache = windowImageCache();
  const images = new Map<string, HTMLImageElement>();
  const active = new Map<string, { url: string; revision: number; release: () => void }>();
  const revision = ref(0);
  let disposed = false;
  function synchronize() {
    const items = enabled() ? source() : [],
      next = new Map(items.map((item) => [cache.key(session(), item.resource), item]));
    for (const [key, entry] of active) {
      const item = next.get(key),
        image = item ? cache.peek(session(), item.resource) : null;
      if (item?.url === entry.url && entry.revision === cache.revision(session(), item.resource) && (image || !images.has(key))) continue;
      entry.release();
      active.delete(key);
      images.delete(key);
    }
    for (const [key, item] of next) {
      if (active.has(key) || (!item.url && !cache.peek(session(), item.resource))) continue;
      const acquired = cache.acquire(session(), item.resource, item.url),
        entry = { url: item.url, revision: cache.revision(session(), item.resource), release: acquired.release };
      active.set(key, entry);
      if (acquired.image) images.set(key, acquired.image);
      else
        void acquired.promise
          .then((image) => {
            if (disposed || active.get(key) !== entry || entry.revision !== cache.revision(session(), item.resource)) return;
            images.set(key, image);
            revision.value++;
          })
          .catch((error) => {
            if (!disposed && active.get(key) === entry) {
              entry.release();
              active.delete(key);
              if (!isReadInvalidated(error)) failed(error);
            }
          });
    }
    changed();
  }
  watch(() => [enabled(), source().map((item) => [item.url, cache.revision(session(), item.resource)])], synchronize, {
    immediate: true,
    flush: 'sync',
  });
  watch(revision, changed, { flush: 'post' });
  onScopeDispose(() => {
    disposed = true;
    for (const entry of active.values()) entry.release();
    active.clear();
    images.clear();
  });
  return {
    image: (resource: ResourceRef) => images.get(cache.key(session(), resource)) ?? null,
    ready: () => source().every((item) => Boolean(images.get(cache.key(session(), item.resource)))),
  };
}
