import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import ResourceThumbnail from './ResourceThumbnail.vue';
import type { ResourceRef } from '@/shared/types';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/settings';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
afterEach(() => {
  windowImageRuntime().clearSession('thumbnail-test');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  initializeCacheLimits(createSettingsFixture().cacheLimits);
});
describe('resident resource thumbnail display', () => {
  it('keeps the completed display through hidden return and resize with zero idle budgets', async () => {
    installCanvas2DStub();
    const limits = createSettingsFixture().cacheLimits;
    limits.decodedImages.entries = limits.thumbnails.entries = 0;
    initializeCacheLimits(limits);
    const images: Array<{ onload: () => void }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 32;
        height = 32;
        onload = () => {};
        onerror = () => {};
        src = '';
        constructor() {
          images.push(this);
        }
      },
    );
    const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'a', relPath: 'zero.png', key: 'sprite' };
    const own = mount(ResourceThumbnail, { props: { sessionId: 'thumbnail-test', resource, url: 'data:zero', label: 'Zero' } });
    await flushPromises();
    images[0]!.onload();
    await flushPromises();
    const canvas = own.get('canvas').element;
    await own.setProps({ active: false });
    await own.setProps({ active: true });
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(own.get('canvas').element).toBe(canvas);
    expect(images).toHaveLength(1);
    expect(windowImageRuntime().stats().decoded).toMatchObject({ activeEntries: 0, idleEntries: 0 });
    own.unmount();
  });
  it('draws the previously completed thumbnail on remount and retains its physical size across DPR changes', async () => {
    installCanvas2DStub();
    const images: Array<{ onload: () => void }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 40;
        height = 20;
        onload = () => {};
        onerror = () => {};
        src = '';
        constructor() {
          images.push(this);
        }
      },
    );
    const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'a', relPath: 'thumbnail.png', key: 'sprite' };
    const props = { sessionId: 'thumbnail-test', resource, url: 'data:thumbnail', label: 'Weapon', width: 20, height: 20 };
    const first = mount(ResourceThumbnail, { props });
    await flushPromises();
    expect(images).toHaveLength(1);
    images[0]!.onload();
    await flushPromises();
    first.unmount();
    const hits = windowImageRuntime().stats().thumbnailHits,
      second = mount(ResourceThumbnail, { props });
    await flushPromises();
    expect(images).toHaveLength(1);
    expect(windowImageRuntime().stats().thumbnailHits).toBeGreaterThan(hits);
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(1);
    vi.stubGlobal('devicePixelRatio', 1.5);
    window.dispatchEvent(new Event('resize'));
    expect(second.get('canvas').element.width).toBe(30);
    expect(images).toHaveLength(1);
    await second.setProps({ active: false });
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(0);
    second.unmount();
  });
});
