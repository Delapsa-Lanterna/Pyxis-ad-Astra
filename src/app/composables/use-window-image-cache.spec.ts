import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createWindowImageCache } from './use-window-image-cache';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/settings';
import type { ResourceRef } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  listener: null as ((event: import('@/services/resource-cache.service').ResourceCacheInvalidationEvent) => void) | null,
}));
vi.mock('@/services/resource-media.service', () => ({
  subscribeResourceMediaInvalidations: (callback: typeof mocks.listener) => {
    mocks.listener = callback;
    return vi.fn();
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  initializeCacheLimits(createSettingsFixture().cacheLimits);
});
const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'a', key: 'sprite', relPath: 'a.png' };
function fixture() {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal(
    'Image',
    class {
      width = 4;
      height = 4;
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        images.push(this as unknown as HTMLImageElement);
      }
    },
  );
  return { images, cache: createWindowImageCache() };
}
describe('window image residence', () => {
  it('keeps a replaced thumbnail active when the old display releases it', () => {
    const { cache } = fixture();
    const first = { width: 4, height: 4 } as HTMLCanvasElement,
      second = { width: 8, height: 8 } as HTMLCanvasElement;
    const oldRelease = cache.storeThumbnail('thumb', 's', [resource], first),
      nextRelease = cache.storeThumbnail('thumb', 's', [resource], second);
    oldRelease();
    expect(cache.thumbnail('thumb')).toBe(second);
    expect(cache.stats().thumbnails).toMatchObject({ activeEntries: 1, activeBytes: 256, idleEntries: 0 });
    nextRelease();
    expect(cache.stats().thumbnails).toMatchObject({ activeEntries: 0, idleEntries: 1 });
    cache.dispose();
  });
  it('limits shared preloading to four jobs and drops obsolete queued work', async () => {
    const { cache } = fixture(),
      controller = new AbortController(),
      finish: Array<() => void> = [],
      started: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, index) =>
      cache.preload(
        () =>
          new Promise<void>((resolve) => {
            started.push(index);
            finish.push(resolve);
          }),
        controller.signal,
      ),
    );
    const ended = Promise.allSettled(jobs);
    expect(started).toEqual([0, 1, 2, 3]);
    controller.abort();
    finish.forEach((done) => done());
    await ended;
    expect(started).toEqual([0, 1, 2, 3]);
    cache.dispose();
  });
  it('shares one decode, holds active references and synchronously reuses the accepted result', async () => {
    const { cache, images } = fixture();
    const first = cache.acquire('s', resource, 'data:a'),
      second = cache.acquire('s', resource, 'data:a');
    expect(images).toHaveLength(1);
    images[0]!.onload!(new Event('load'));
    await Promise.all([first.promise, second.promise]);
    await flushPromises();
    first.release();
    expect(cache.stats().decoded.activeEntries).toBe(1);
    second.release();
    expect(cache.stats().decoded.idleEntries).toBe(1);
    const repeat = cache.acquire('s', resource, 'data:a');
    expect(repeat.image).toBe(images[0]);
    expect(images).toHaveLength(1);
    repeat.release();
    cache.dispose();
  });
  it('isolates sessions, invalidates dependent thumbnails and rejects an obsolete decode', async () => {
    const { cache, images } = fixture();
    const first = cache.acquire('a', resource, 'old');
    const ended = expect(first.promise).rejects.toMatchObject({ code: 'query.invalidated' });
    const retain = cache.storeThumbnail('a-thumb', 'a', [resource], { width: 4, height: 4 } as HTMLCanvasElement);
    mocks.listener!({ scope: 'resources', sessionId: 'a', resources: [resource], invalidation: null });
    await ended;
    expect(cache.thumbnail('a-thumb')).toBeNull();
    const next = cache.acquire('a', resource, 'new'),
      other = cache.acquire('b', resource, 'other');
    images[0]!.onload!(new Event('load'));
    images[1]!.onload!(new Event('load'));
    images[2]!.onload!(new Event('load'));
    await Promise.all([next.promise, other.promise]);
    expect(cache.peek('a', resource)).toBe(images[1]);
    expect(cache.peek('b', resource)).toBe(images[2]);
    first.release();
    next.release();
    other.release();
    retain();
    cache.clearSession('a');
    expect(cache.peek('a', resource)).toBeNull();
    expect(cache.peek('b', resource)).toBe(images[2]);
    cache.dispose();
  });
  it('retries failures and releases zero-budget results after use', async () => {
    const limits = createSettingsFixture().cacheLimits;
    limits.decodedImages.entries = 0;
    initializeCacheLimits(limits);
    const { cache, images } = fixture();
    const first = cache.acquire('s', resource, 'bad'),
      rejected = expect(first.promise).rejects.toThrow('图片解码失败');
    images[0]!.onerror!(new Event('error'));
    await rejected;
    first.release();
    const next = cache.acquire('s', resource, 'good');
    images[1]!.onload!(new Event('load'));
    await next.promise;
    await flushPromises();
    expect(cache.stats().decoded.activeEntries).toBe(1);
    next.release();
    expect(cache.peek('s', resource)).toBeNull();
    cache.dispose();
  });
});
