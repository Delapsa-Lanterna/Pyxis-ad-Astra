import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { installCanvas2DStub } from '@/test/unit/canvas-stub';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import ImmersiveHullScene from './ImmersiveHullScene.vue';
import { loadEngineFallbacks } from '@/app/renderers/editors/engine-fallback';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '@/test/fixtures/settings';
const mocks = vi.hoisted(() => ({
  images: new Map<string, HTMLImageElement>(),
  engines: {} as Record<string, HTMLImageElement>,
  resources: {} as import('@/shared/types').EngineRenderAssets['resources'],
  styles: {} as import('@/shared/types').RowData,
}));
vi.mock('@/services/engine-assets.service', () => ({
  queryEngineRenderAssets: async () => ({ styles: mocks.styles, versions: [], resources: mocks.resources }),
  hasEngineAssetsInvalidation: () => false,
}));
vi.mock('@/app/renderers/editors/engine-fallback', () => ({
  engineFallback: (key: string) => mocks.engines[key] ?? null,
  loadEngineFallbacks: vi.fn(async () => mocks.engines),
}));
vi.mock('@/app/composables/use-resource-images', () => ({
  useResourceImages: () => ({ image: (resource: { relPath: string }) => mocks.images.get(resource.relPath) ?? null, ready: () => true }),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: vi.fn(), dataUrl: () => '' }),
}));
afterEach(() => {
  windowImageRuntime().clearSession('s');
  mocks.images.clear();
  mocks.engines = {};
  mocks.styles = {};
  initializeCacheLimits(createSettingsFixture().cacheLimits);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('variant scene pointer dismissal', () => {
  it.each(['LAUNCH_BAY', 'SYSTEM', 'DECORATIVE'])('uses the same pointer and keyboard targets around %s slots', async (type) => {
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
    const variant = projectVariantPanel(snapshot, Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])))
      .variants[0]!;
    const original = variant.weapons[0]!;
    const excluded = { ...original, slot: { ...original.slot, type } };
    const own = mount(ImmersiveHullScene, {
      props: { variant: { ...variant, weapons: [excluded, variant.weapons[1]!] }, sessionId: 's' },
      global: { stubs: { ImmersiveText: true } },
    });
    await own.get('canvas').trigger('mousemove', { clientX: 390, clientY: 350 });
    expect(own.find('.variant-slot-label').exists()).toBe(false);
    await own.get('canvas').trigger('mousedown', { button: 0, clientX: 390, clientY: 350 });
    expect(own.emitted('blank')).toHaveLength(1);
    expect(own.emitted('slot')).toBeUndefined();
    await own.get('canvas').trigger('mousedown', { button: 0, clientX: 480, clientY: 410 });
    expect(own.emitted('slot')?.at(-1)?.[0]).toBe(1);
    await own.get('.variant-scene').trigger('keydown', { key: 'ArrowRight' });
    await own.get('.variant-scene').trigger('keydown', { key: 'Enter' });
    expect(own.emitted('slot')?.at(-1)?.[0]).toBe(1);
    own.unmount();
  });
  it('shows the installed module name and follows module replacement and removal', async () => {
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
    const variant = projectVariantPanel(snapshot, Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])))
      .variants[0]!;
    const weapon = variant.weapons[0]!;
    const slot = { ...weapon.slot, type: 'STATION_MODULE', mount: 'HIDDEN' };
    const scene = { ...variant, weapons: [{ ...weapon, slot, id: '', name: '', builtin: false }] };
    const module = { slot, variant: { ...variant, key: 'module', name: 'Sample module', modules: [] } };
    const drawSlot = vi.spyOn(await import('@/app/renderers/editors/canvas-visuals'), 'drawWeaponSlotVisual');
    const drawMount = vi.spyOn(await import('@/app/renderers/immersive/weapon-mount'), 'drawWeaponMount');
    const own = mount(ImmersiveHullScene, {
      props: { variant: { ...scene, modules: [module] }, sessionId: 's' },
      global: { stubs: { ImmersiveText: { props: ['text'], template: '<span>{{ text }}</span>' } } },
    });
    expect(drawSlot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'STATION_MODULE', mount: 'HIDDEN' }));
    expect(drawMount.mock.calls.every(([, type]) => type === 'STATION_MODULE')).toBe(true);
    drawMount.mockClear();
    await own.setProps({ variant: module.variant });
    expect(new Set(drawMount.mock.calls.map(([, type]) => type))).toEqual(
      new Set(module.variant.weapons.map((weapon) => weapon.slot.type)),
    );
    await own.setProps({ variant: { ...scene, modules: [module] } });
    await own.get('canvas').trigger('mousemove', { clientX: 390, clientY: 350 });
    expect(own.get('.variant-slot-label').text()).toBe('Sample module');
    await own.get('canvas').trigger('mousedown', { button: 0, clientX: 390, clientY: 350 });
    expect(own.emitted('module')).toEqual([[0, { x: 390, y: 350 }]]);
    await own.setProps({ variant: { ...scene, modules: [{ ...module, variant: { ...module.variant, name: 'Replacement module' } }] } });
    expect(own.get('.variant-slot-label').text()).toBe('Replacement module');
    for (const [hullName, expected] of [
      ['Sample hull', 'Sample hull'],
      ['', 'sample_hull'],
    ] as const) {
      const unnamed = { ...module.variant, name: '', spec: { ...module.variant.spec, hullName, hullId: 'sample_hull' } };
      await own.setProps({ variant: { ...scene, modules: [{ ...module, variant: unnamed }] } });
      expect(own.get('.variant-slot-label').text()).toBe(expected);
    }
    drawSlot.mockClear();
    await own.setProps({ variant: { ...scene, modules: [] } });
    expect(drawSlot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'STATION_MODULE', mount: 'HIDDEN' }));
    expect(own.get('.variant-slot-label').text()).toBe('空槽');
    await own.get('canvas').trigger('mousedown', { button: 0, clientX: 390, clientY: 350 });
    expect(own.emitted('module')).toHaveLength(2);
    await own.setProps({
      variant: { ...variant, weapons: [{ ...weapon, slot: { ...weapon.slot, mount: 'HIDDEN' }, name: 'Sample weapon', builtin: true }] },
    });
    expect(drawMount).toHaveBeenCalledWith(expect.anything(), weapon.slot.type, weapon.slot.size, expect.any(Number));
    expect(own.get('.variant-slot-label').text()).toBe('Sample weapon（内置）');
    own.unmount();
  });
  it('shares three bundled SVG decodes and returns their ready images synchronously', async () => {
    const actual = await vi.importActual<typeof import('@/app/renderers/editors/engine-fallback')>(
      '@/app/renderers/editors/engine-fallback',
    );
    const images: HTMLImageElement[] = [];
    vi.stubGlobal(
      'Image',
      class extends Image {
        constructor() {
          super();
          images.push(this);
        }
      },
    );
    const first = actual.loadEngineFallbacks();
    expect(actual.loadEngineFallbacks()).toBe(first);
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.src).toContain('data:image/svg+xml');
      image.onload!(new Event('load'));
    }
    const ready = await first;
    for (const [key, image] of Object.entries(ready)) expect(actual.engineFallback(key)).toBe(image);
  });
  it.each([0, 1, 3])('reuses engine products with %i source images and releases replaced colors and the scene', async (ready) => {
    installCanvas2DStub();
    const context = document.createElement('canvas').getContext('2d')!;
    Object.defineProperty(context, 'createImageData', {
      configurable: true,
      value: (width: number, height: number) => ({ width, data: new Uint8ClampedArray(width * height * 4) }),
    });
    Object.defineProperty(context, 'createRadialGradient', { configurable: true, value: () => context.createLinearGradient(0, 0, 1, 1) });
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
    mocks.resources = Object.fromEntries(
      ['engineGlow', 'engineFlame', 'engineHitGlow'].map((key, index) => {
        const path = ['graphics/fx/engineglow32.png', 'graphics/fx/engineflame32.png', 'graphics/fx/hit_glow.png'][index]!;
        const image = new Image();
        image.width = 16;
        image.height = 8;
        mocks.engines[key] = image;
        if (index < ready) mocks.images.set(path, image);
        return [path, { source: 'core' as const, ownerKind: 'ship' as const, ownerId: 'sample', key, relPath: path }];
      }),
    ) as import('@/shared/types').EngineRenderAssets['resources'];
    const creates = vi.spyOn(document, 'createElement');
    const fallback = { ...mocks.engines };
    mocks.engines = {};
    vi.mocked(loadEngineFallbacks).mockImplementation(async () => (mocks.engines = fallback));
    const own = mount(ImmersiveHullScene, { props: { variant, sessionId: 's' }, global: { stubs: { ImmersiveText: true } } });
    await flushPromises();
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(1);
    const other = mount(ImmersiveHullScene, { props: { variant, sessionId: 'other' }, global: { stubs: { ImmersiveText: true } } });
    await flushPromises();
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(2);
    other.unmount();
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(1);
    const allocated = creates.mock.calls.filter(([tag]) => tag === 'canvas').length;
    await own.find('canvas').trigger('mousemove', { clientX: 20, clientY: 20 });
    await own.find('canvas').trigger('wheel', { deltaY: -1 });
    expect(creates.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(allocated);
    for (const resource of Object.values(mocks.resources)) mocks.images.set(resource.relPath, new Image());
    for (const image of mocks.images.values()) {
      image.width = 32;
      image.height = 32;
    }
    await own.find('canvas').trigger('wheel', { deltaY: 1 });
    expect(windowImageRuntime().stats().thumbnails).toMatchObject({ activeEntries: 1, idleEntries: 0 });
    const originals = creates.mock.calls.filter(([tag]) => tag === 'canvas').length;
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
    await own.find('canvas').trigger('wheel', { deltaY: -1 });
    expect(creates.mock.calls.filter(([tag]) => tag === 'canvas').length).toBeGreaterThan(originals);
    expect(windowImageRuntime().stats().thumbnails).toMatchObject({ activeEntries: 1, idleEntries: 0 });
    await own.setProps({
      variant: { ...variant, spec: { ...variant.spec, engineSlots: [{ ...engine, styleSpec: { engineColor: [90, 60, 30, 255] } }] } },
    });
    await flushPromises();
    expect(creates.mock.calls.filter(([tag]) => tag === 'canvas').length).toBeGreaterThan(allocated);
    expect(windowImageRuntime().stats().thumbnails).toMatchObject({ activeEntries: 1, idleEntries: 0 });
    await own.setProps({ sessionId: 'replacement' });
    await flushPromises();
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(1);
    if (ready === 0) {
      await own.setProps({ variant: { ...variant, spec: { ...variant.spec, engineSlots: [{ ...engine, styleSpec: {} }] } } });
      await flushPromises();
      expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(1);
    }
    own.unmount();
    expect(windowImageRuntime().stats().thumbnails).toMatchObject({ activeEntries: 0, idleEntries: 0 });
    mocks.engines = {};
    const late = mount(ImmersiveHullScene, { props: { variant, sessionId: 's' }, global: { stubs: { ImmersiveText: true } } });
    late.unmount();
    const released = creates.mock.calls.length;
    await flushPromises();
    expect(creates.mock.calls).toHaveLength(released);
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
    const hit = new MouseEvent('contextmenu', { button: 2, clientX: 390, clientY: 350, bubbles: true, cancelable: true });
    expect(canvas.element.dispatchEvent(hit)).toBe(false);
    expect(own.emitted('remove')).toEqual([[0]]);
    const blank = new MouseEvent('contextmenu', { button: 2, clientX: 20, clientY: 20, bubbles: true, cancelable: true });
    expect(canvas.element.dispatchEvent(blank)).toBe(true);
    expect(own.emitted('remove')).toHaveLength(1);
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
