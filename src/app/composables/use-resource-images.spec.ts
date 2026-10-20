import { effectScope, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { ResourceRef } from '@/shared/types';
import { useResourceImages } from './use-resource-images';

const cache = vi.hoisted(() => ({
  events: [] as string[],
  image: { width: 4, height: 4 } as HTMLImageElement,
  acquire: vi.fn(),
}));
vi.mock('./use-window-image-runtime', () => ({
  windowImageRuntime: () => ({
    key: (session: string, resource: ResourceRef) => session + resource.relPath,
    revision: () => 0,
    peek: () => cache.image,
    acquire: cache.acquire,
  }),
}));
afterEach(() => vi.clearAllMocks());

it('acquires replacements before releasing old decodes and rejects late images after disposal', async () => {
  const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'fixture', key: 'sprite', relPath: 'first.png' };
  const source = ref([{ resource, url: 'data:first' }]);
  let complete!: (image: HTMLImageElement) => void;
  cache.events.length = 0;
  cache.acquire.mockImplementation((_session: string, _resource: ResourceRef, url: string) => {
    cache.events.push('acquire:' + url);
    return {
      image: url === 'data:first' ? cache.image : null,
      promise: new Promise<HTMLImageElement>((resolve) => {
        complete = resolve;
      }),
      release: () => cache.events.push('release:' + url),
    };
  });
  const scope = effectScope(),
    failed = vi.fn(),
    images = scope.run(() =>
      useResourceImages(
        () => 's',
        () => source.value,
        vi.fn(),
        failed,
      ),
    )!;
  expect(images.image(resource)).toBe(cache.image);
  source.value = [{ resource: { ...resource, relPath: 'second.png' }, url: 'data:second' }];
  expect(cache.events).toEqual(['acquire:data:first', 'acquire:data:second', 'release:data:first']);
  scope.stop();
  complete(cache.image);
  await flushPromises();
  expect(images.image(source.value[0]!.resource)).toBeNull();
  expect(cache.events.at(-1)).toBe('release:data:second');
  expect(failed).not.toHaveBeenCalled();
});
