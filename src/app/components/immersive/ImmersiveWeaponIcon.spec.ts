import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImmersiveWeaponIcon from './ImmersiveWeaponIcon.vue';
import type { ResourceRef } from '@/shared/types';
import { windowImageCache } from '@/app/composables/use-window-image-cache';

const feedback = vi.hoisted(() => ({ error: vi.fn() }));
let iconSurface: import('@vue/test-utils').VueWrapper | null = null;
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => feedback }));
afterEach(() => {
  iconSurface?.unmount();
  iconSurface = null;
  windowImageCache().clearSession('icon-test');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  feedback.error.mockReset();
});

function harness() {
  const images: Array<{ width: number; height: number; onload: () => void; onerror: () => void; src: string }> = [];
  vi.stubGlobal(
    'Image',
    class {
      width = 80;
      height = 40;
      onload = () => {};
      onerror = () => {};
      src = '';
      constructor() {
        images.push(this);
      }
    },
  );
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const resource = (key: string): ResourceRef => ({ source: 'mod', ownerKind: 'weapon', ownerId: 'w', key, relPath: key + '.png' });
  const layers = ['under', 'main'].map((key) => ({ resource: resource(key), origin: { x: 0.5, y: 0.5 } }));
  const wrapper = mount(ImmersiveWeaponIcon, {
    props: {
      sessionId: 'icon-test',
      layers,
      url: (resource: ResourceRef) => resource.key,
      label: 'Weapon',
      mountType: 'BALLISTIC',
      mountSize: 'MEDIUM',
    },
  });
  iconSurface = wrapper;
  return { wrapper, images, context, layers, resource };
}
describe('static weapon icon and owned decode lifetime', () => {
  it('reuses decoded layers for DPI changes without starting another image read', async () => {
    const own = harness();
    await flushPromises();
    own.images.forEach((image) => image.onload());
    await flushPromises();
    const count = own.images.length;
    vi.stubGlobal('devicePixelRatio', 2);
    window.dispatchEvent(new Event('resize'));
    expect(own.wrapper.find('canvas').element.width).toBe(160);
    expect(own.images).toHaveLength(count);
    expect(own.context.scale).toHaveBeenLastCalledWith(2, 2);
    own.wrapper.unmount();
  });
  it('uses the projectile center, dimensions and formal barrel positions', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.setProps({
      loadedMissile: { resource: own.resource('missile'), size: [12, 24], center: [6, 12], offsets: [10, 2], angles: [15] },
    });
    own.images.slice(2).forEach((image) => image.onload());
    await flushPromises();
    expect(own.context.translate).toHaveBeenCalledWith(-2, -10);
    expect(own.context.drawImage.mock.calls.at(-1)!.slice(1)).toEqual([-6, -12, 12, 24]);
    own.wrapper.unmount();
  });
  it('composes complete first-frame images in the formal layer order', async () => {
    const own = harness();
    await flushPromises();
    own.images.forEach((image) => image.onload());
    await flushPromises();
    expect(own.context.drawImage.mock.calls.filter((call) => call[0] instanceof Image).map((call) => call[0].src)).toEqual([
      'under',
      'main',
    ]);
    expect(own.context.drawImage.mock.calls[0]!.slice(1)).toEqual([0, 0, 80, 40, -40, -20, 80, 40]);
    expect(own.context.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(own.context.fill.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(own.context.imageSmoothingEnabled).toBe(false);
    own.wrapper.unmount();
  });
  it('accepts only the replacement layers and ignores a late decode failure', async () => {
    const own = harness();
    await flushPromises();
    const previous = [...own.images];
    await own.wrapper.setProps({ layers: [{ resource: own.resource('next'), origin: { x: 0.5, y: 0.5 } }] });
    own.images.at(-1)!.onload();
    await flushPromises();
    previous[0]!.onerror();
    await flushPromises();
    expect(own.context.drawImage.mock.calls.filter((call) => call[0] instanceof Image)).toHaveLength(1);
    expect(own.context.drawImage.mock.calls[0]![0].src).toBe('next');
    expect(feedback.error).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('releases decoding on unmount and preserves the new lifecycle surface', async () => {
    const own = harness();
    await flushPromises();
    own.wrapper.unmount();
    own.images.forEach((image) => image.onload());
    await flushPromises();
    expect(own.context.drawImage).not.toHaveBeenCalled();
  });
});
