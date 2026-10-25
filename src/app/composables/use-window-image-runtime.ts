import { onScopeDispose, ref } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { mediaResourceKey } from '@/services/resource-media.service';
import { subscribeResourceInvalidations } from '@/services/resource-media.service';
import { acquireResourceMedia, disposeResourceMedia } from '@/services/resource-media.service';
import { createResidentCache } from '@/shared/runtime/resident-cache';
import { subscribeCacheLimits, windowCacheLimits } from '@/shared/runtime/cache-limits';
import { createReadTicket, invalidatedRead, waitForRead, type ReadTicket } from '@/shared/runtime/read-request';
import { debugLog } from '@/shared/runtime/app-log-queue';

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
  missing: ResourceRef[];
}
export interface ThumbnailRequest {
  key: string;
  sessionId: string;
  resources: readonly ResourceRef[];
  url?: (resource: ResourceRef) => string;
  render(image: (resource: ResourceRef) => HTMLImageElement | null): HTMLCanvasElement;
  capture?(): ThumbnailRequest;
}
interface ThumbnailLoad {
  source: ThumbnailRequest;
  request: ReadTicket<HTMLCanvasElement>;
  accepted: Promise<HTMLCanvasElement>;
  references: number;
  canvas: HTMLCanvasElement | null;
  start(): Promise<HTMLCanvasElement>;
}
export function createWindowImageRuntime() {
  const decoded = createResidentCache<DecodedImage>(
    () => ({
      entries: windowCacheLimits().decodedImages.entries,
      bytes: windowCacheLimits().decodedImages.MiB * 1024 * 1024,
    }),
    'decoded-images',
  );
  const thumbnails = createResidentCache<Thumbnail>(
    () => ({
      entries: windowCacheLimits().thumbnails.entries,
      bytes: windowCacheLimits().thumbnails.MiB * 1024 * 1024,
    }),
    'thumbnails',
  );
  const pending = new Map<string, ImageLoad>();
  const stopDecoded = subscribeCacheLimits(decoded),
    stopThumbnails = subscribeCacheLimits(thumbnails);
  const products = new Map<string, ThumbnailLoad>();
  const revisions = new Map<string, number>();
  const sessionRevisions = new Map<string, number>();
  let revisionClock = 0;
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
    return Math.max(sessionRevisions.get(sessionId) ?? 0, revisions.get(key(sessionId, resource)) ?? 0);
  }
  function removeImage(physicalKey: string) {
    decoded.remove(physicalKey);
    pending.get(physicalKey)?.request.invalidate('project');
    pending.delete(physicalKey);
    for (const [id, product] of products)
      if (product.source.resources.some((resource) => key(product.source.sessionId, resource) === physicalKey)) {
        product.request.invalidate('project');
        products.delete(id);
      }
    revisions.set(physicalKey, ++revisionClock);
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
      debugLog('media.decode_started', () => ({ sessionId, source: resource.source, relPath: resource.relPath }));
      const image = new Image();
      decodeCount++;
      const entry = { sessionId, resource, url, image };
      const request = createReadTicket(
        { sessionId, resource, revision: revision(sessionId, resource) },
        () =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            image.onload = () => {
              debugLog('media.decoded', () => ({ sessionId, source: resource.source, relPath: resource.relPath }));
              image.onload = null;
              image.onerror = null;
              resolve(image);
            };
            image.onerror = () => {
              debugLog('media.decode_failed', () => ({ sessionId, source: resource.source, relPath: resource.relPath }));
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
    debugLog('media.product_accepted', () => ({ sessionId, id }));
    const entry = { sessionId, dependencies: new Set(resources.map((resource) => key(sessionId, resource))), canvas, missing: [] };
    thumbnails.put(id, entry, canvas.width * canvas.height * 4, 1);
    return () => {
      if (thumbnails.get(id) === entry) thumbnails.release(id);
    };
  }
  function retainThumbnail(id: string) {
    return thumbnails.retain(id);
  }
  function acquireThumbnail(source: ThumbnailRequest, priority?: 'visible' | 'near', afterVisible = Promise.resolve()) {
    const cached = thumbnails.get(source.key);
    if (cached) {
      thumbnailHits++;
      return { canvas: cached.canvas, promise: Promise.resolve(cached.canvas), release: thumbnails.retain(source.key) };
    }
    if (
      !products.has(source.key) &&
      source.resources.every((resource) => {
        const entry = decoded.get(key(source.sessionId, resource)),
          url = source.url?.(resource);
        return entry && (!url || entry.url === url);
      })
    ) {
      const canvas = source.render((resource) => peek(source.sessionId, resource));
      return { canvas, promise: Promise.resolve(canvas), release: storeThumbnail(source.key, source.sessionId, source.resources, canvas) };
    }
    let product = products.get(source.key);
    if (!product) {
      let start!: () => Promise<HTMLCanvasElement>;
      let captured!: ThumbnailLoad;
      const request: ReadTicket<HTMLCanvasElement> = createReadTicket({ sessionId: source.sessionId, thumbnail: source.key }, (signal) =>
        new Promise<{ canvas: HTMLCanvasElement; missing: ResourceRef[] }>((resolve, reject) => {
          let started = false;
          start = () => {
            if (!started) {
              started = true;
              void renderThumbnail(source, signal).then(resolve, reject);
            }
            return request.promise;
          };
        }).then(({ canvas, missing }) => {
          if (signal.aborted) throw invalidatedRead({ sessionId: source.sessionId, thumbnail: source.key }, 'project');
          captured.canvas = canvas;
          debugLog('media.product_accepted', () => ({ sessionId: source.sessionId, id: source.key }));
          thumbnails.put(
            source.key,
            {
              sessionId: source.sessionId,
              dependencies: new Set(source.resources.map((resource) => key(source.sessionId, resource))),
              canvas,
              missing,
            },
            canvas.width * canvas.height * 4,
            captured.references,
          );
          return canvas;
        }),
      );
      const accepted = request.promise.then((value) => {
        request.accept();
        return value;
      });
      product = captured = { source, request, accepted, references: 0, canvas: null, start };
      products.set(source.key, product);
      const settled = () => {
        if (products.get(source.key) === captured) products.delete(source.key);
      };
      void accepted.then(settled, settled);
      if (priority !== 'visible')
        void afterVisible
          .then(() => preload(() => start().then(() => undefined), request.signal))
          .catch(() => request.invalidate('consumer'));
      else void start();
    } else if (priority === 'visible') void product.start();
    const captured = product;
    captured.references++;
    let released = false;
    return {
      canvas: null,
      promise: captured.accepted,
      release: () => {
        if (released) return;
        released = true;
        captured.references--;
        if (!captured.references && !captured.canvas) {
          captured.request.invalidate('consumer');
          if (products.get(source.key) === captured) products.delete(source.key);
        }
        const entry = thumbnails.get(source.key);
        if (entry && entry.canvas === captured.canvas) thumbnails.release(source.key);
      },
    };
  }
  async function renderThumbnail(source: ThumbnailRequest, signal: AbortSignal) {
    const supplied = source.resources.map((resource) => source.url?.(resource) ?? null);
    const media = source.resources.map((resource, index) => (supplied[index] ? null : acquireResourceMedia(source.sessionId, resource)));
    const images: ReturnType<typeof acquire>[] = [];
    try {
      const urls = media.some(Boolean)
        ? await waitForRead(
            Promise.all(media.map((lease, index) => (lease ? lease.ready : Promise.resolve(supplied[index]!)))),
            { thumbnail: source.key },
            signal,
          )
        : supplied;
      if (signal.aborted) throw invalidatedRead({ sessionId: source.sessionId }, 'consumer');
      const byKey = new Map<string, HTMLImageElement>();
      await waitForRead(
        Promise.all(
          urls.map(async (url, index) => {
            if (!url) return;
            const resource = source.resources[index]!,
              image = acquire(source.sessionId, resource, url);
            images.push(image);
            byKey.set(key(source.sessionId, resource), await image.promise);
          }),
        ),
        { thumbnail: source.key },
        signal,
      );
      if (signal.aborted) throw invalidatedRead({ sessionId: source.sessionId }, 'consumer');
      return {
        canvas: source.render((resource) => byKey.get(key(source.sessionId, resource)) ?? null),
        missing: source.resources.filter((_resource, index) => !urls[index]),
      };
    } finally {
      images.forEach((image) => image.release());
      media.forEach((lease) => lease?.release());
    }
  }
  function clearSession(sessionId: string) {
    debugLog('media.session_released', () => ({ sessionId }));
    const prefix = JSON.stringify([sessionId]).slice(0, -1);
    for (const physicalKey of new Set([...decoded.keys(), ...pending.keys(), ...revisions.keys()]))
      if (physicalKey.startsWith(prefix)) {
        decoded.remove(physicalKey);
        pending.get(physicalKey)?.request.invalidate('session');
        pending.delete(physicalKey);
        revisions.delete(physicalKey);
      }
    for (const id of [...thumbnails.keys()]) if (thumbnails.get(id)!.sessionId === sessionId) thumbnails.remove(id);
    for (const [id, product] of products)
      if (product.source.sessionId === sessionId) {
        product.request.invalidate('session');
        products.delete(id);
      }
    sessionRevisions.set(sessionId, ++revisionClock);
    queueMicrotask(() => {
      epoch.value++;
    });
  }
  const stop = subscribeResourceInvalidations((event) => {
    if (event.scope === 'session' || event.invalidation?.session) clearSession(event.sessionId);
    else
      for (const physicalKey of new Set(
        [...event.resources, ...(event.invalidation?.resources ?? [])].map((resource) => key(event.sessionId, resource)),
      ))
        removeImage(physicalKey);
  });
  function dispose() {
    debugLog('media.runtime_released', () => ({ images: String(decoded.stats().activeEntries + decoded.stats().idleEntries) }));
    stopDecoded();
    stopThumbnails();
    for (const job of preloadQueue) job.reject(invalidatedRead({ lane: 'image-preload' }, 'consumer'));
    preloadQueue.length = 0;
    stop();
    for (const load of pending.values()) load.request.invalidate('consumer');
    pending.clear();
    for (const product of products.values()) product.request.invalidate('consumer');
    products.clear();
    decoded.clear();
    thumbnails.clear();
    revisions.clear();
    sessionRevisions.clear();
  }
  return {
    acquire,
    acquireThumbnail,
    thumbnailFailures: (id: string) => thumbnails.get(id)?.missing ?? [],
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
      pending: pending.size + products.size,
      decodeCount,
      imageHits,
      thumbnailHits,
    }),
  };
}
let runtime: ReturnType<typeof createWindowImageRuntime> | null = null;
export function windowImageRuntime() {
  return (runtime ??= createWindowImageRuntime());
}
export function useWindowImageRuntimeLifetime() {
  const owned = windowImageRuntime();
  onScopeDispose(() => {
    owned.dispose();
    disposeResourceMedia();
    if (runtime === owned) runtime = null;
  });
}
