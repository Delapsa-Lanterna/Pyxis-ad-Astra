import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs, nSwitch } from '@/test/ui-stubs';
import { createSettingsFixture } from '@/test/settings';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { disposeResourceMedia, resourceMediaStats, RESOURCE_MEDIA_FLUSH_DELAY_MS } from '@/services/resource-media.service';
import WeaponFirePreview from './WeaponFirePreview.vue';
import * as previewRenderer from '@/app/renderers/weapon-fire-preview/scene';
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
  vi.useRealTimers();
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
function observeScene() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 200 } as DOMRect);
  const render = vi.spyOn(previewRenderer, 'renderWeaponFirePreviewScene').mockImplementation(() => {});
  return () => render.mock.calls.at(-1)![1];
}
async function wheel(deltaY: number, clientX = 100, clientY = 100) {
  wrapper!.get('canvas').element.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX, clientY, bubbles: true }));
  await wrapper!.vm.$nextTick();
}
describe('preview playback and media lifecycle', () => {
  it('pauses on either step and restores recorded frames without rerolling shots', async () => {
    const scene = observeScene(),
      editor = open();
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    await editor.getComponent(nSwitch).trigger('click');
    const tick = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    tick(1000);
    tick(1100);
    const earlier = JSON.stringify(scene().projectiles);
    tick(1300);
    await editor.vm.$nextTick();
    const later = JSON.stringify(scene().projectiles),
      frames = vi.mocked(requestAnimationFrame).mock.calls.length;
    await button('上一帧').trigger('click');
    expect(button('播放').exists()).toBe(true);
    expect(JSON.stringify(scene().projectiles)).toBe(earlier);
    const random = vi.spyOn(Math, 'random');
    await button('下一帧').trigger('click');
    expect(JSON.stringify(scene().projectiles)).toBe(later);
    expect(random).not.toHaveBeenCalled();
    await editor.get('.n-slider-stub').setValue('5');
    await wheel(-1);
    const camera = scene().base,
      age = scene().projectiles[0]!.age;
    await button('下一帧').trigger('click');
    expect(scene().projectiles[0]!.age - age).toBeCloseTo(1 / 60);
    expect(scene().base.center).toEqual(camera.center);
    expect(scene().base.scale).toBe(camera.scale);
    expect(editor.get('.preview-speed-header-value').text()).toBe('5.0x');
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(frames);
    await button('播放').trigger('click');
    await button('下一帧').trigger('click');
    expect(button('播放').exists()).toBe(true);
  });
  it('retains 120 states including the current frame and branches when playback resumes', async () => {
    const scene = observeScene();
    open();
    await wrapper!.getComponent(nSwitch).trigger('click');
    const tick = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    for (let index = 0; index <= 130; index++) tick(1000 + index * 10);
    await wrapper!.vm.$nextTick();
    const latest = JSON.stringify(scene().projectiles);
    for (let index = 0; index < 119; index++) await button('上一帧').trigger('click');
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    expect(scene().projectiles[0]!.age).toBeCloseTo(0.11);
    for (let index = 0; index < 119; index++) await button('下一帧').trigger('click');
    expect(JSON.stringify(scene().projectiles)).toBe(latest);
    await button('上一帧').trigger('click');
    const age = scene().projectiles[0]!.age;
    await button('播放').trigger('click');
    await button('下一帧').trigger('click');
    expect(scene().projectiles[0]!.age - age).toBeCloseTo(1 / 60);
  });
  it('keeps history across redraws and starts a new history at each simulation condition change', async () => {
    const scene = observeScene(),
      editor = open();
    await editor.getComponent(nSwitch).trigger('click');
    await button('下一帧').trigger('click');
    const original = JSON.stringify(scene().projectiles);
    await editor.get('canvas').trigger('mousemove', { clientX: 120, clientY: 80 });
    await wheel(-1);
    window.dispatchEvent(new Event('resize'));
    const settings = useSettingsStore();
    settings.replaceSettings({ ...settings.settingsSnapshot(), theme: 'dark' });
    await flushPromises();
    expect(button('上一帧').attributes('disabled')).toBeUndefined();
    expect(JSON.stringify(scene().projectiles)).toBe(original);
    await button('固定视图 H').trigger('click');
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    expect(JSON.stringify(scene().projectiles)).toBe(original);
    await button('下一帧').trigger('click');
    const age = scene().projectiles[0]!.age;
    await editor.setProps({ weaponCsvRow: { range: 1200, 'proj speed': 200 } });
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    expect(scene().projectiles[0]!.age).toBe(age);
    await button('下一帧').trigger('click');
    await editor.getComponent(nSwitch).trigger('click');
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    await button('下一帧').trigger('click');
    await button('重置').trigger('click');
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    expect(scene().projectiles).toHaveLength(0);
    await button('下一帧').trigger('click');
    await editor.setProps({ weaponId: 'another-preview' });
    expect(button('上一帧').attributes('disabled')).toBeDefined();
    expect(scene().projectiles).toHaveLength(0);
  });
  it('projects the cursor, anchors zoom and preserves paused projectiles during navigation', async () => {
    const scene = observeScene(),
      editor = open(),
      canvas = editor.get('canvas');
    await editor.getComponent(nSwitch).trigger('click');
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1000);
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1100);
    await button('暂停').trigger('click');
    const projectiles = JSON.stringify(scene().projectiles),
      frames = vi.mocked(requestAnimationFrame).mock.calls.length;
    expect(scene().projectiles.length).toBeGreaterThan(0);
    expect(scene().base.center).toEqual({ x: 80, y: 100 });
    await canvas.trigger('mousemove', { clientX: 200, clientY: 80 });
    expect(scene().base.cursor?.label).toBe('277.0, 46.0');
    await wheel(-1, 200, 80);
    expect(scene().base.cursor?.label).toBe('277.0, 46.0');
    expect(scene().base.center.x).toBeCloseTo(68);
    expect(button('适应视图').attributes('aria-pressed')).toBe('false');
    await button('适应视图').trigger('click');
    await canvas.trigger('mousedown', { button: 2, clientX: 200, clientY: 80 });
    expect(button('适应视图').attributes('aria-pressed')).toBe('true');
    await canvas.trigger('mousemove', { clientX: 220, clientY: 80 });
    expect(scene().base.center).toEqual({ x: 100, y: 100 });
    await canvas.trigger('mouseleave');
    expect(scene().base.cursor).toBeNull();
    await canvas.trigger('mousemove', { clientX: 250, clientY: 80 });
    expect(scene().base.center).toEqual({ x: 100, y: 100 });
    expect(JSON.stringify(scene().projectiles)).toBe(projectiles);
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(frames);
  });
  it('retains manual viewing across playback reset, mount changes, source updates and resize', async () => {
    const scene = observeScene(),
      editor = open();
    await button('暂停').trigger('click');
    await wheel(-1, 200, 100);
    const center = { ...scene().base.center },
      scale = scene().base.scale;
    await button('固定视图 H').trigger('click');
    await button('重置').trigger('click');
    await button('暂停').trigger('click');
    await editor.setProps({ weaponCsvRow: { range: 1200, 'proj speed': 200 } });
    expect(scene().base.center).toEqual(center);
    expect(scene().base.scale).toBe(scale);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 800, height: 400 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(scene().base.scale).toBe(scale);
    expect(scene().base.center).toEqual({ x: center.x + 200, y: center.y + 100 });
    await button('适应视图').trigger('click');
    expect(scene().base.center).toEqual({ x: 80, y: 200 });
    expect(scene().base.scale).toBeCloseTo(660 / 1200);
    await editor.setProps({ weaponCsvRow: { range: 600, 'proj speed': 200 } });
    expect(scene().base.scale).toBeCloseTo(660 / 600);
    expect(button('适应视图').attributes('aria-pressed')).toBe('true');
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ width: 400, height: 200 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(scene().base.center).toEqual({ x: 80, y: 100 });
    expect(scene().base.scale).toBeCloseTo(260 / 600);
  });
  it('uses relative zoom limits and lets the playing frame own navigation redraws', async () => {
    const scene = observeScene(),
      editor = open(),
      canvas = editor.get('canvas');
    await flushPromises();
    const initial = scene(),
      frames = vi.mocked(requestAnimationFrame).mock.calls.length;
    await canvas.trigger('mousemove', { clientX: 100, clientY: 100 });
    await wheel(-1);
    expect(scene()).toBe(initial);
    expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(frames);
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](1000);
    expect(scene().base.cursor).not.toBeNull();
    await button('暂停').trigger('click');
    for (let i = 0; i < 100; i++) await wheel(-1);
    expect(scene().base.scale).toBeCloseTo((260 / 600) * 20);
    for (let i = 0; i < 100; i++) await wheel(1);
    expect(scene().base.scale).toBeCloseTo((260 / 600) * 0.1);
  });
  it('retains playback, firing, mode and speed across definition updates', async () => {
    open();
    await wrapper!.getComponent(nSwitch).trigger('click');
    await button('暂停').trigger('click');
    await button('固定视图 H').trigger('click');
    await wrapper!.get('.n-slider-stub').setValue('2.5');
    expect(wrapper!.get('.preview-speed-header-value').text()).toBe('2.5x');
    await wrapper!.setProps({ projectile: { id: 'shot', specClass: 'missile', size: [10, 20], center: [5, 10], engineSlots: [] } });
    expect(button('播放').exists()).toBe(true);
    expect(wrapper!.getComponent(nSwitch).props('value')).toBe(true);
    expect(button('固定视图 H').classes()).toContain('active');
    expect(wrapper!.get('.preview-speed-header-value').text()).toBe('2.5x');
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
    await vi.advanceTimersByTimeAsync(RESOURCE_MEDIA_FLUSH_DELAY_MS);
    await flushPromises();
    const reads = mocks.invoke.mock.calls.filter((call) => call[0] === 'query_resource_data_urls');
    expect(reads).toHaveLength(1);
    expect(reads[0]![1].payload.resources).toHaveLength(1);
    wrapper!.unmount();
    wrapper = null;
    expect(resourceMediaStats().activeEntries).toBe(0);
  });
  it('retains born media for rewind and releases it when recorded frames expire', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    const resource = {
      source: 'mod' as const,
      ownerKind: 'projectile' as const,
      ownerId: 'shot',
      key: 'bulletSprite',
      relPath: 'old-shot.png',
    };
    await wrapper!.setProps({
      weaponCsvRow: { range: 1, 'proj speed': 100, chargedown: 10 },
      resources: { weapon: {}, projectile: { bulletSprite: resource } },
    });
    await wrapper!.getComponent(nSwitch).trigger('click');
    const tick = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    tick(1000);
    await wrapper!.setProps({ resources: { weapon: {}, projectile: { bulletSprite: { ...resource, relPath: 'new-shot.png' } } } });
    tick(1400);
    await vi.advanceTimersByTimeAsync(RESOURCE_MEDIA_FLUSH_DELAY_MS);
    await flushPromises();
    expect(resourceMediaStats().activeEntries).toBe(2);
    await button('上一帧').trigger('click');
    await button('下一帧').trigger('click');
    await button('播放').trigger('click');
    const next = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    for (let index = 0; index <= 120; index++) next(2000 + index * 10);
    await vi.advanceTimersByTimeAsync(RESOURCE_MEDIA_FLUSH_DELAY_MS);
    await flushPromises();
    expect(resourceMediaStats().activeEntries).toBe(1);
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
