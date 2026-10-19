import { onScopeDispose, ref } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { mediaResourceKey } from '@/services/resource-cache.service';
import { subscribeResourceMediaInvalidations } from '@/services/resource-media.service';
import { createResidentCache } from '@/shared/runtime/resident-cache';
import { windowCacheLimits } from '@/shared/runtime/cache-limits';
import { createReadTicket, invalidatedRead, type ReadTicket } from '@/shared/runtime/read-request';

interface DecodedImage {
  sessionId: string;
  resource: ResourceRef;
  url: string;
  image: HTMLImageElement;
}
interface ImageLoad {
  request: ReadTicket<HTMLImageElement>;
  entry: DecodedImage;
  consumers: number;
}
interface Thumbnail {
  sessionId: string;
  dependencies: Set<string>;
  canvas: HTMLCanvasElement;
}
export function createWindowImageCache() {
  const decoded = createResidentCache<DecodedImage>(() => ({
    entries: windowCacheLimits().decodedImages.entries,
    bytes: windowCacheLimits().decodedImages.MiB * 1024 * 1024,
  }));
  const thumbnails = createResidentCache<Thumbnail>(() => ({
    entries: windowCacheLimits().thumbnails.entries,
    bytes: windowCacheLimits().thumbnails.MiB * 1024 * 1024,
  }));
  const pending = new Map<string, ImageLoad>();
  const revisions = new Map<string, number>();
  const epoch = ref(0);
  const preloadQueue: Array<{ task: () => Promise<void>; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void }> = [];
  let preloadRunning = 0;
  function drainPreload() {
    while (preloadRunning < 4 && preloadQueue.length) {
      const job = preloadQueue.shift()!;
      if (job.signal.aborted) {
        job.reject(invalidatedRead({ lane: 'image-preload' }, 'consumer'));
        continue;
      }
      preloadRunning++;
      void job
        .task()
        .then(job.resolve, job.reject)
        .finally(() => {
          preloadRunning--;
          drainPreload();
        });
    }
  }
  function preload(task: () => Promise<void>, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      preloadQueue.push({ task, signal, resolve, reject });
      drainPreload();
    });
  }
  let decodeCount = 0,
    imageHits = 0,
    thumbnailHits = 0;
  function key(sessionId: string, resource: Pick<ResourceRef, 'source' | 'relPath'>) {
    return mediaResourceKey(sessionId, resource);
  }
  function revision(sessionId: string, resource: ResourceRef) {
    void epoch.value;
    return revisions.get(key(sessionId, resource)) ?? 0;
  }
  function removeImage(physicalKey: string) {
    decoded.remove(physicalKey);
    pending.get(physicalKey)?.request.invalidate('project');
    pending.delete(physicalKey);
    revisions.set(physicalKey, (revisions.get(physicalKey) ?? 0) + 1);
    for (const id of [...thumbnails.keys()]) if (thumbnails.get(id)!.dependencies.has(physicalKey)) thumbnails.remove(id);
    queueMicrotask(() => {
      epoch.value++;
    });
  }
  function acquire(sessionId: string, resource: ResourceRef, url: string) {
    const physicalKey = key(sessionId, resource);
    const cached = decoded.get(physicalKey);
    if (cached && url && cached.url !== url) removeImage(physicalKey);
    const ready = decoded.get(physicalKey);
    if (ready) {
      imageHits++;
      return { image: ready.image, promise: Promise.resolve(ready.image), release: decoded.retain(physicalKey) };
    }
    let load = pending.get(physicalKey);
    if (load && load.entry.url !== url) {
      removeImage(physicalKey);
      load = undefined;
    }
    if (!load) {
      const image = new Image();
      decodeCount++;
      const entry = { sessionId, resource, url, image };
      const request = createReadTicket(
        { sessionId, resource, revision: revision(sessionId, resource) },
        () =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            image.onload = () => {
              image.onload = null;
              image.onerror = null;
              resolve(image);
            };
            image.onerror = () => {
              image.onload = null;
              image.onerror = null;
              reject(new Error('图片解码失败'));
            };
            image.src = url;
          }),
      );
      load = { request, entry, consumers: 0 };
      pending.set(physicalKey, load);
      const captured = load;
      void request.promise
        .then((value) => {
          request.accept();
          if (pending.get(physicalKey) !== captured) return;
          decoded.put(physicalKey, entry, value.width * value.height * 4, captured.consumers);
          pending.delete(physicalKey);
        })
        .catch(() => {
          if (pending.get(physicalKey) === captured) pending.delete(physicalKey);
        });
    }
    const captured = load;
    captured.consumers++;
    let released = false;
    return {
      image: null,
      promise: captured.request.promise.then((image) => {
        captured.request.accept();
        return image;
      }),
      release: () => {
        if (released) return;
        released = true;
        captured.consumers--;
        const readyEntry = decoded.get(physicalKey);
        if (readyEntry === captured.entry) {
          decoded.release(physicalKey);
        }
      },
    };
  }
  function peek(sessionId: string, resource: ResourceRef) {
    return decoded.get(key(sessionId, resource))?.image ?? null;
  }
  function thumbnail(id: string) {
    const item = thumbnails.get(id);
    if (item) thumbnailHits++;
    return item?.canvas ?? null;
  }
  function storeThumbnail(id: string, sessionId: string, resources: readonly ResourceRef[], canvas: HTMLCanvasElement) {
    const entry = { sessionId, dependencies: new Set(resources.map((resource) => key(sessionId, resource))), canvas };
    thumbnails.put(id, entry, canvas.width * canvas.height * 4, 1);
    return () => {
      if (thumbnails.get(id) === entry) thumbnails.release(id);
    };
  }
  function retainThumbnail(id: string) {
    return thumbnails.retain(id);
  }
  function clearSession(sessionId: string) {
    const prefix = JSON.stringify([sessionId]).slice(0, -1);
    for (const physicalKey of new Set([...decoded.keys(), ...pending.keys(), ...revisions.keys()]))
      if (physicalKey.startsWith(prefix)) {
        removeImage(physicalKey);
        revisions.delete(physicalKey);
      }
    for (const id of [...thumbnails.keys()]) if (thumbnails.get(id)!.sessionId === sessionId) thumbnails.remove(id);
  }
  const stop = subscribeResourceMediaInvalidations((event) => {
    if (event.scope === 'session' || event.invalidation?.session) clearSession(event.sessionId);
    else for (const resource of [...event.resources, ...(event.invalidation?.resources ?? [])]) removeImage(key(event.sessionId, resource));
  });
  function dispose() {
    for (const job of preloadQueue) job.reject(invalidatedRead({ lane: 'image-preload' }, 'consumer'));
    preloadQueue.length = 0;
    stop();
    for (const load of pending.values()) load.request.invalidate('consumer');
    pending.clear();
    decoded.clear();
    thumbnails.clear();
    revisions.clear();
  }
  return {
    acquire,
    preload,
    peek,
    key,
    revision,
    thumbnail,
    storeThumbnail,
    retainThumbnail,
    dispose,
    clearSession,
    stats: () => ({
      decoded: decoded.stats(),
      thumbnails: thumbnails.stats(),
      pending: pending.size,
      decodeCount,
      imageHits,
      thumbnailHits,
    }),
  };
}
let runtime: ReturnType<typeof createWindowImageCache> | null = null;
export function windowImageCache() {
  return (runtime ??= createWindowImageCache());
}
export function useWindowImageCacheLifetime() {
  const owned = windowImageCache();
  onScopeDispose(() => {
    owned.dispose();
    if (runtime === owned) runtime = null;
  });
}
