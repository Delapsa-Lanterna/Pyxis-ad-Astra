import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  }),
}));

import WeaponFirePreview from './WeaponFirePreview.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#2563eb',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  installCanvas2DStub();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountPreview(overrides: Record<string, unknown> = {}) {
  wrapper = mount(WeaponFirePreview, {
    props: {
      weaponId: 'railgun',
      weaponCsvRow: { id: 'railgun', 'damage/shot': 50 },
      weaponSpec: { id: 'railgun', specClass: 'projectile', type: 'BALLISTIC', projectileSpecId: 'proj1' },
      projectileSpecs: { proj1: { id: 'proj1', 'speed max': 400, 'damage/shot': 25 } },
      spriteData: {},
      ...overrides,
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('WeaponFirePreview', () => {
  it('skips transparent glow while the simulation remains playing and redraws it when alpha changes', async () => {
    vi.stubGlobal(
      'Image',
      class {
        width = 2;
        height = 2;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const request = vi.fn(() => 31);
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0) }));
    const original = document.createElement('canvas').getContext('2d')!;
    const context = new Proxy(original, {
      get(target, property) {
        if (property === 'drawImage') return drawImage;
        if (property === 'getImageData') return getImageData;
        return Reflect.get(target, property);
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const weaponSpec = { id: 'railgun', specClass: 'projectile', glowColor: [100, 200, 50, 0] };
    const preview = mountPreview({ weaponSpec, spriteData: { turretGlowSprite: 'glow' } });
    await flushPromises();
    expect(drawImage).toHaveBeenCalledTimes(0);
    expect(getImageData).toHaveBeenCalledTimes(0);
    expect(request).toHaveBeenCalledOnce();
    expect(preview.findAll('button').some((button) => button.text() === '暂停')).toBe(true);
    await preview.setProps({ weaponSpec: { ...weaponSpec, glowColor: [100, 200, 50, 128] } });
    expect(drawImage).toHaveBeenCalledTimes(16);
    expect(getImageData).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    await preview
      .findAll('button')
      .find((button) => button.text() === '暂停')!
      .trigger('click');
    drawImage.mockClear();
    getImageData.mockClear();
    await preview.setProps({ weaponSpec });
    expect(drawImage).toHaveBeenCalledTimes(0);
    expect(getImageData).toHaveBeenCalledTimes(0);
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps glow animation paused while accepting color changes and releasing resources', async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 2;
        height = 2;
        onload: (() => void) | null = null;
        constructor() {
          images.push(this);
        }
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const request = vi.fn(() => 29);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const preview = mountPreview({ spriteData: { turretGlowSprite: 'glow' } });
    await preview.vm.$nextTick();
    await preview
      .findAll('button')
      .find((button) => button.text() === '暂停')!
      .trigger('click');
    const frames = request.mock.calls.length;
    await preview.setProps({
      weaponSpec: { id: 'railgun', specClass: 'projectile', glowColor: [100, 200, 50, 128], renderHints: ['RENDER_BARREL_BELOW'] },
    });
    expect(request).toHaveBeenCalledTimes(frames);
    expect(preview.findAll('button').some((button) => button.text() === '播放')).toBe(true);
    await preview.setProps({ spriteData: {} });
    expect(images.every((image) => image.onload === null)).toBe(true);
    preview.unmount();
    wrapper = null;
    expect(cancel).toHaveBeenCalledWith(29);
  });
  it('redraws a paused preview immediately when mirrored theme settings change', async () => {
    const colors: string[] = [];
    const original = document.createElement('canvas').getContext('2d')!;
    const context = new Proxy(original, {
      set(_target, property, value) {
        if (property === 'fillStyle') colors.push(value);
        return true;
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const preview = mountPreview();
    const settings = useSettingsStore();
    expect(colors).toContain(settings.themeColors.panelMuted);
    await preview
      .findAll('button')
      .find((button) => button.text() === '暂停')!
      .trigger('click');
    const frames = requestFrame.mock.calls.length;
    colors.length = 0;
    settings.replaceSettings({ ...settings.settingsSnapshot(), theme: 'dark', accent: 'orange' });
    await preview.vm.$nextTick();
    expect(colors[0]).toBe(settings.themeColors.panelMuted);
    expect(preview.findAll('button').some((button) => button.text() === '播放')).toBe(true);
    expect(requestFrame).toHaveBeenCalledTimes(frames);
    colors.length = 0;
    settings.setCustomAccent('#123456');
    await preview.vm.$nextTick();
    expect(colors[0]).toBe(settings.themeColors.panelMuted);
  });
  it('renders the weapon and projectile identity in the header', () => {
    const preview = mountPreview();
    expect(preview.get('.editor-title strong').text()).toBe('发射预览');
    expect(preview.get('.editor-title span').text()).toContain('railgun');
    expect(preview.get('.editor-title span').text()).toContain('proj1');
  });

  it('reports a missing weapon spec through the subtitle state', () => {
    const preview = mountPreview({ weaponSpec: {}, projectileSpecs: {} });
    expect(preview.get('.editor-title span').text()).toContain('railgun');
  });

  it('exposes the play controls of the canvas stage', () => {
    const preview = mountPreview();
    const buttons = preview.findAll('button').map((button) => button.text());
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('computes the barrel count from the turret offsets', async () => {
    const preview = mountPreview({
      weaponSpec: {
        id: 'railgun',
        specClass: 'projectile',
        type: 'BALLISTIC',
        projectileSpecId: 'proj1',
        turretOffsets: [10, 0, -10, 0],
        turretAngleOffsets: [0, 0],
      },
    });
    await vi.waitFor(() => expect(preview.find('canvas').exists()).toBe(true));
    expect(preview.findAll('canvas').length).toBeGreaterThan(0);
  });
});
