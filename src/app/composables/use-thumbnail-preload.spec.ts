import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ThumbnailRequest } from './use-window-image-runtime';
import type { ResourceMediaInvalidationEvent } from '@/services/resource-media.service';
import { useThumbnailPreload } from './use-thumbnail-preload';
const mock = vi.hoisted(() => ({
  acquire: vi.fn(),
  error: vi.fn(),
  release: vi.fn(),
  listener: null as ((event: ResourceMediaInvalidationEvent) => void) | null,
}));
vi.mock('./use-app-feedback', () => ({ useAppFeedback: () => ({ error: mock.error, warning: vi.fn() }) }));
vi.mock('@/services/resource-media.service', () => ({
  resourceMediaDataUrl: () => '',
  subscribeResourceInvalidations: (listener: typeof mock.listener) => {
    mock.listener = listener;
    return () => {
      mock.listener = null;
    };
  },
}));
vi.mock('./use-window-image-runtime', () => ({
  windowImageRuntime: () => ({ acquireThumbnail: mock.acquire, thumbnailFailures: () => [], key: () => '', revision: () => 0 }),
}));
const request: ThumbnailRequest = { key: 'one', sessionId: 's', resources: [], render: () => document.createElement('canvas') };
beforeEach(() => {
  vi.resetAllMocks();
  mock.acquire.mockImplementation(() => ({ promise: Promise.resolve(document.createElement('canvas')), release: mock.release }));
});
it('recaptures current source versions and pixel ratio while releasing the previous product', async () => {
  let version = 0;
  const source = { ...request, capture: () => ({ ...request, key: 'current/' + ++version }) };
  const scope = effectScope(),
    owner = scope.run(() => useThumbnailPreload('test'))!;
  owner.prepare('s', [source], []);
  await flushPromises();
  window.dispatchEvent(new Event('resize'));
  await flushPromises();
  expect(mock.acquire.mock.lastCall![0].key).toBe('current/1');
  mock.listener!({ sessionId: 's', scope: 'resources', resources: [], invalidation: null });
  await flushPromises();
  scope.stop();
  expect(mock.listener).toBeNull();
});
it('retries a failed preparation and releases replacement ranges', async () => {
  mock.acquire.mockReturnValueOnce({ promise: Promise.reject(new Error('decode')), release: mock.release });
  const scope = effectScope(),
    owner = scope.run(() => useThumbnailPreload('test'))!;
  owner.prepare('s', [request], []);
  await flushPromises();
  expect(mock.error).toHaveBeenCalledOnce();
  owner.prepare('s', [request], []);
  await flushPromises();
  expect(mock.acquire).toHaveBeenCalledTimes(2);
  owner.prepare('s', [], []);
  expect(mock.release).toHaveBeenCalledTimes(2);
  scope.stop();
});
it('keeps stable ranges and submits neighboring work behind visible completion', async () => {
  const scope = effectScope(),
    owner = scope.run(() => useThumbnailPreload('test'))!;
  const near = { ...request, key: 'near' };
  owner.prepare('s', [request], [near]);
  owner.prepare('s', [request], [near]);
  await flushPromises();
  expect(mock.acquire).toHaveBeenCalledTimes(2);
  expect(mock.acquire.mock.calls.map((call) => call[1])).toEqual(['visible', 'near']);
  expect(mock.acquire.mock.calls[1]![2]).toBeInstanceOf(Promise);
  scope.stop();
  expect(mock.release).toHaveBeenCalledTimes(2);
});
