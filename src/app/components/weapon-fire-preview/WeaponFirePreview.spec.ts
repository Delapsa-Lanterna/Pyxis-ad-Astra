import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs, nSwitch } from '@/test/ui-stubs';
import { createSettingsFixture } from '@/test/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { disposeResourceMedia, resourceMediaStats } from '@/services/resource-media.service';
import WeaponFirePreview from './WeaponFirePreview.vue';
const mocks = vi.hoisted(() => ({ error: vi.fn(), invoke: vi.fn() }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/shared/runtime/command.runtime', () => ({ invokeCommand: mocks.invoke }));
let wrapper: VueWrapper | null = null;
beforeEach(() => {
  setActivePinia(createPinia());
  const settings = createSettingsFixture();
  initializeSettingsStore(settings);
  initializeCacheLimits(settings.cacheLimits);
  installCanvas2DStub();
  mocks.invoke.mockImplementation(async (command, params) =>
    command === 'query_resource_data_urls'
      ? { entries: params.payload.resources.map((resource: object) => ({ ...resource, dataUrl: null })) }
      : { styles: {}, versions: [], resources: {} },
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 31),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  windowImageRuntime().clearSession('preview');
  disposeResourceMedia();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function open() {
  wrapper = mount(WeaponFirePreview, {
    props: {
      sessionId: 'preview',
      weaponId: 'fixture',
      weaponCsvRow: { range: 600, 'proj speed': 100 },
      weaponSpec: { id: 'fixture', specClass: 'projectile', projectileSpecId: 'shot' },
      projectile: { id: 'shot', specClass: 'projectile', length: 30, width: 5, fadeTime: 0.3 },
      resources: { weapon: {}, projectile: {} },
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper;
}
function button(text: string) {
  return wrapper!.findAll('button').find((item) => item.text() === text)!;
}
describe('preview playback and media lifecycle', () => {
  it('retains playback, firing, mode and speed across definition updates', async () => {
    open();
    await wrapper!.getComponent(nSwitch).trigger('click');
    await button('暂停').trigger('click');
    await button('固定视图 H').trigger('click');
    await wrapper!.setProps({ projectile: { id: 'shot', specClass: 'missile', size: [10, 20], center: [5, 10], engineSlots: [] } });
    expect(button('播放').exists()).toBe(true);
    expect(wrapper!.getComponent(nSwitch).props('value')).toBe(true);
    expect(wrapper!.get('h1').text()).toContain('fixture');
    expect(wrapper!.get('h1').text()).toContain('shot');
  });
  it('restarts a paused simulation on fire and releases its frame on unmount', async () => {
    open();
    await button('暂停').trigger('click');
    const before = vi.mocked(requestAnimationFrame).mock.calls.length;
    await wrapper!.getComponent(nSwitch).trigger('click');
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(before + 1);
    wrapper!.unmount();
    wrapper = null;
    expect(cancelAnimationFrame).toHaveBeenCalledWith(31);
  });
  it('redraws theme and view changes while playback is paused', async () => {
    open();
    await button('暂停').trigger('click');
    const before = vi.mocked(requestAnimationFrame).mock.calls.length;
    const settings = useSettingsStore();
    settings.replaceSettings({ ...settings.settingsSnapshot(), theme: 'dark' });
    await wrapper!.vm.$nextTick();
    await button('固定视图 H').trigger('click');
    expect(button('播放').exists()).toBe(true);
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(before);
  });
  it('shares physical media across weapon and projectile roles and releases active references', async () => {
    open();
    const resource = {
      source: 'mod' as const,
      ownerKind: 'weapon' as const,
      ownerId: 'fixture',
      key: 'turretSprite',
      relPath: 'graphics/shared.png',
    };
    await wrapper!.setProps({
      resources: {
        weapon: { turretSprite: resource },
        projectile: { bulletSprite: { ...resource, ownerId: 'shot', key: 'bulletSprite' } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    await flushPromises();
    const reads = mocks.invoke.mock.calls.filter((call) => call[0] === 'query_resource_data_urls');
    expect(reads).toHaveLength(1);
    expect(reads[0]![1].payload.resources).toHaveLength(1);
    wrapper!.unmount();
    wrapper = null;
    expect(resourceMediaStats().activeEntries).toBe(0);
  });
  it('prepares glow only for visible alpha and releases paused products with zero idle budgets', async () => {
    const limits = createSettingsFixture().cacheLimits;
    limits.decodedImages.entries = limits.thumbnails.entries = limits.mediaData.entries = 0;
    initializeCacheLimits(limits);
    vi.stubGlobal(
      'Image',
      class {
        width = 4;
        height = 4;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    mocks.invoke.mockImplementation(async (_command, params) => ({
      entries: params.payload.resources.map((resource: object) => ({ ...resource, dataUrl: 'data:image/png;base64,fixture' })),
    }));
    const context = document.createElement('canvas').getContext('2d')!,
      tint = vi.fn(() => ({ data: new Uint8ClampedArray(0) }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(context, {
        get: (target, key) => (key === 'getImageData' ? tint : Reflect.get(target, key)),
      }),
    );
    open();
    await button('暂停').trigger('click');
    const weapon = { id: 'fixture', specClass: 'projectile', glowColor: [100, 160, 255, 0] };
    await wrapper!.setProps({
      weaponSpec: weapon,
      resources: {
        weapon: {
          turretGlowSprite: { source: 'mod', ownerKind: 'weapon', ownerId: 'fixture', key: 'turretGlowSprite', relPath: 'glow.png' },
        },
        projectile: {},
      },
    });
    await flushPromises();
    expect(tint).not.toHaveBeenCalled();
    await wrapper!.setProps({ weaponSpec: { ...weapon, glowColor: [100, 160, 255, 128] } });
    await flushPromises();
    expect(tint).not.toHaveBeenCalled();
    await wrapper!.getComponent(nSwitch).trigger('click');
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1000);
    await button('暂停').trigger('click');
    await flushPromises();
    expect(tint).toHaveBeenCalledOnce();
    const frames = vi.mocked(requestAnimationFrame).mock.calls.length;
    await wrapper!.setProps({ weaponSpec: { ...weapon, glowColor: [100, 160, 255, 200] } });
    expect(button('播放').exists()).toBe(true);
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(frames);
    wrapper!.unmount();
    wrapper = null;
    expect(windowImageRuntime().stats().decoded.activeEntries).toBe(0);
    expect(windowImageRuntime().stats().thumbnails.activeEntries).toBe(0);
    expect(resourceMediaStats().activeEntries).toBe(0);
  });
  it('uses one switch to start, stop and reset firing', async () => {
    open();
    const firing = wrapper!.getComponent(nSwitch);
    expect(firing.props('value')).toBe(false);
    await firing.trigger('click');
    expect(firing.props('value')).toBe(true);
    await firing.trigger('click');
    expect(firing.props('value')).toBe(false);
    await firing.trigger('click');
    await button('重置').trigger('click');
    expect(firing.props('value')).toBe(false);
  });
});
