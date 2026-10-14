import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import ResourceThumbnail from './ResourceThumbnail.vue';
import type { ResourceRef } from '@/shared/types';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
afterEach(() => {
  windowImageCache().clearSession('thumbnail-test');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('resident resource thumbnail display', () => {
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
    const hits = windowImageCache().stats().thumbnailHits,
      second = mount(ResourceThumbnail, { props });
    await flushPromises();
    expect(images).toHaveLength(1);
    expect(windowImageCache().stats().thumbnailHits).toBeGreaterThan(hits);
    expect(windowImageCache().stats().thumbnails.activeEntries).toBe(1);
    vi.stubGlobal('devicePixelRatio', 1.5);
    window.dispatchEvent(new Event('resize'));
    expect(second.get('canvas').element.width).toBe(30);
    expect(images).toHaveLength(1);
    await second.setProps({ active: false });
    expect(windowImageCache().stats().thumbnails.activeEntries).toBe(0);
    second.unmount();
  });
});
