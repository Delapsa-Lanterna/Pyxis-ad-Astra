import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceRef } from '@/shared/types';
import { useImagePreload } from './use-image-preload';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  peek: vi.fn(),
  replace: vi.fn(),
  release: vi.fn(),
  error: vi.fn(),
  preload: vi.fn(),
}));
vi.mock('./use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('./use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({
    replaceCollection: mocks.replace,
    releaseCollection: mocks.release,
    dataUrl: () => 'data:image',
  }),
}));
vi.mock('./use-window-image-cache', () => ({
  windowImageCache: () => ({
    key: (session: string, resource: ResourceRef) => session + '/' + resource.relPath,
    revision: () => 0,
    peek: mocks.peek,
    acquire: mocks.acquire,
    preload: mocks.preload,
  }),
}));
const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'a', key: 'sprite', relPath: 'a.png' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.replace.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(undefined);
  mocks.preload.mockImplementation((task: () => Promise<void>) => task());
});
describe('image preload ownership', () => {
  it('releases a failed visible decode and retries the same requested range', async () => {
    const release = vi.fn();
    mocks.acquire.mockImplementation(() => ({ promise: Promise.reject(new Error('decode failed')), release }));
    const scope = effectScope(),
      owner = scope.run(() => useImagePreload('test'))!;
    owner.prepare('s', [resource], []);
    await flushPromises();
    expect(release).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    owner.prepare('s', [resource], []);
    await flushPromises();
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    scope.stop();
  });
  it('releases cancelled neighboring media while preserving a ready visible working set', async () => {
    let finish!: () => void;
    mocks.replace.mockImplementation((_session: string, id: string) =>
      id.startsWith('near/') ? new Promise<void>((resolve) => (finish = resolve)) : Promise.resolve(),
    );
    const release = vi.fn();
    mocks.acquire.mockReturnValue({ promise: Promise.resolve({}), release });
    const scope = effectScope(),
      owner = scope.run(() => useImagePreload('test'))!;
    owner.prepare('s', [], [resource]);
    await flushPromises();
    mocks.peek.mockReturnValue({});
    owner.prepare('s', [resource], []);
    finish();
    await flushPromises();
    expect(mocks.release).toHaveBeenCalledWith('near/1/0');
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(0);
    scope.stop();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
