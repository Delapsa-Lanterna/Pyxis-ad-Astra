import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import ImmersiveHullScene from './ImmersiveHullScene.vue';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/settings';
const mocks = vi.hoisted(() => ({ images: new Map<string, HTMLImageElement>() }));
vi.mock('@/app/composables/use-resource-images', () => ({
  useResourceImages: () => ({ image: (resource: { relPath: string }) => mocks.images.get(resource.relPath) ?? null, ready: () => true }),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: vi.fn(), dataUrl: () => '' }),
}));
afterEach(() => {
  windowImageCache().clearSession('s');
  mocks.images.clear();
  initializeCacheLimits(createSettingsFixture().cacheLimits);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('variant scene pointer dismissal', () => {
  it('reuses engine tint products across repaints and releases replaced colors and the scene', async () => {
    installCanvas2DStub();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 700,
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      toJSON: () => ({}),
    });
    const limits = createSettingsFixture().cacheLimits;
    limits.thumbnails.entries = 0;
    initializeCacheLimits(limits);
    const snapshot = variantJointFixture();
    const variant = projectVariantPanel(snapshot, Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])))
      .variants[0]!;
    const engine = { location: [0, 0], angle: 180, width: 6, length: 10, style: 'CUSTOM', styleSpec: { engineColor: [30, 60, 90, 255] } };
    variant.spec = { ...variant.spec, engineSlots: [engine, { ...engine, location: [10, 0] }] };
    variant.engineResources = Object.fromEntries(
      ['engineGlow', 'engineFlame', 'engineHitGlow'].map((key) => {
        const image = new Image();
        image.width = 16;
        image.height = 8;
        mocks.images.set(key + '.png', image);
        return [key, { source: 'core' as const, ownerKind: 'ship' as const, ownerId: 'sample', key, relPath: key + '.png' }];
      }),
    );
    const creates = vi.spyOn(document, 'createElement');
    const own = mount(ImmersiveHullScene, { props: { variant, sessionId: 's' }, global: { stubs: { ImmersiveText: true } } });
    expect(windowImageCache().stats().thumbnails.activeEntries).toBe(3);
    const allocated = creates.mock.calls.filter(([tag]) => tag === 'canvas').length;
    await own.find('canvas').trigger('mousemove', { clientX: 20, clientY: 20 });
    await own.find('canvas').trigger('wheel', { deltaY: -1 });
    expect(creates.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(allocated);
    await own.setProps({
      variant: { ...variant, spec: { ...variant.spec, engineSlots: [{ ...engine, styleSpec: { engineColor: [90, 60, 30, 255] } }] } },
    });
    expect(creates.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(allocated + 3);
    expect(windowImageCache().stats().thumbnails).toMatchObject({ activeEntries: 3, idleEntries: 0 });
    own.unmount();
    expect(windowImageCache().stats().thumbnails).toMatchObject({ activeEntries: 0, idleEntries: 0 });
  });
  it('distinguishes a blank left click from a weapon hit and right-button navigation', async () => {
    installCanvas2DStub();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      width: 1000,
      height: 700,
      toJSON: () => ({}),
    });
    const snapshot = variantJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    const own = mount(ImmersiveHullScene, {
      props: { variant: projectVariantPanel(snapshot, values).variants[0]!, sessionId: 's' },
      global: { stubs: { ImmersiveText: true } },
    });
    const canvas = own.find('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 390, clientY: 350 });
    expect(own.emitted('slot')).toEqual([[0, { x: 390, y: 350 }]]);
    expect(own.emitted('blank')).toBeUndefined();
    await canvas.trigger('mousedown', { button: 2, clientX: 20, clientY: 20 });
    await canvas.trigger('mousemove', { clientX: 25, clientY: 25 });
    await canvas.trigger('mouseup', { button: 2 });
    expect(own.emitted('blank')).toBeUndefined();
    await canvas.trigger('mousedown', { button: 0, clientX: 20, clientY: 20 });
    expect(own.emitted('blank')).toEqual([[]]);
    expect(own.emitted('slot')).toHaveLength(1);
    own.unmount();
  });
});
