import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { useThemeDomEffect } from './use-theme-dom-effect';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import { THEME_TOKEN_MAP } from '@/domain/settings/theme';

function mountEffect() {
  return mount({
    setup() {
      useThemeDomEffect();
      return () => null;
    },
  });
}

describe('useThemeDomEffect', () => {
  it.each(['light', 'dark'] as const)('publishes every mapped theme value for %s', (theme) => {
    initializeSettingsStore(createSettingsFixture({ theme }));
    const wrapper = mountEffect();
    const colors = useSettingsStore().themeColors;
    for (const [property, field] of Object.entries(THEME_TOKEN_MAP)) {
      expect(colors[field]).not.toBe('');
      expect(document.documentElement.style.getPropertyValue(property)).toBe(colors[field]);
    }
    wrapper.unmount();
  });
  let systemTheme: EventTarget & { matches: boolean };
  it('keeps a fixed window appearance while the mirrored application theme changes', async () => {
    initializeSettingsStore(createSettingsFixture({ theme: 'light' }));
    const wrapper = mount({
      setup() {
        useThemeDomEffect(() => ({ colors: IMMERSIVE_COLORS, theme: 'dark' }));
        return () => null;
      },
    });
    const settings = useSettingsStore();
    settings.setTheme('dark');
    await nextTick();
    settings.setTheme('light');
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(IMMERSIVE_COLORS.background);
    wrapper.unmount();
  });
  it('applies mirrored font choices immediately to the root and Naive UI controls', async () => {
    const { buildThemeOverrides } = await import('@/app/theme-overrides');
    initializeSettingsStore(createSettingsFixture());
    const wrapper = mountEffect();
    const settings = useSettingsStore();
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(settings.fontFamily);
    settings.replaceSettings(createSettingsFixture({ generalFont: 'Microsoft YaHei' }));
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(settings.fontFamily);
    expect(buildThemeOverrides(settings.themeColors, settings.fontFamily).common?.fontFamily).toBe(settings.fontFamily);
    settings.setGeneralFont(null);
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(settings.fontFamily);
    wrapper.unmount();
  });
  beforeEach(() => {
    systemTheme = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => systemTheme),
    );
    setActivePinia(createPinia());
    document.documentElement.dataset.theme = '';
    document.documentElement.style.removeProperty('--color-bg');
    document.documentElement.style.removeProperty('--color-primary');
    document.documentElement.style.removeProperty('--color-overlay');
    document.documentElement.style.removeProperty('--scrollbar-track');
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])('follows the system on startup and when it changes (dark: %s)', async (dark) => {
    systemTheme.matches = dark;
    initializeSettingsStore(createSettingsFixture());
    const wrapper = mountEffect();
    const settings = useSettingsStore();
    expect(settings.theme).toBe(dark ? 'dark' : 'light');
    expect(document.documentElement.dataset.theme).toBe(settings.theme);
    expect(settings.settingsSnapshot().theme).toBeNull();
    systemTheme.matches = !dark;
    systemTheme.dispatchEvent(new Event('change'));
    await nextTick();
    expect(settings.theme).toBe(dark ? 'light' : 'dark');
    expect(document.documentElement.dataset.theme).toBe(settings.theme);
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(settings.themeColors.background);
    settings.setAccent('orange');
    expect(settings.settingsSnapshot().theme).toBeNull();
    wrapper.unmount();
  });

  it.each([false, true])('preserves a manual selection across system changes and reloads (dark: %s)', async (dark) => {
    systemTheme.matches = dark;
    initializeSettingsStore(createSettingsFixture());
    const wrapper = mountEffect();
    const settings = useSettingsStore();
    settings.toggleTheme();
    const chosen = dark ? 'light' : 'dark';
    expect(settings.settingsSnapshot().theme).toBe(chosen);
    systemTheme.matches = !dark;
    systemTheme.dispatchEvent(new Event('change'));
    systemTheme.matches = dark;
    systemTheme.dispatchEvent(new Event('change'));
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe(chosen);
    const snapshot = settings.settingsSnapshot();
    wrapper.unmount();
    setActivePinia(createPinia());
    initializeSettingsStore(snapshot);
    const restored = mountEffect();
    expect(useSettingsStore().theme).toBe(chosen);
    expect(document.documentElement.dataset.theme).toBe(chosen);
    restored.unmount();
  });

  it('resolves mirrored preferences using the current system theme', async () => {
    systemTheme.matches = true;
    initializeSettingsStore(createSettingsFixture({ theme: 'light' }));
    const wrapper = mountEffect();
    const settings = useSettingsStore();
    settings.replaceSettings(createSettingsFixture());
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('dark');
    settings.replaceSettings(createSettingsFixture({ theme: 'light' }));
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('light');
    wrapper.unmount();
  });

  it('releases the system preference listener when the window unmounts', () => {
    initializeSettingsStore(createSettingsFixture());
    const removeListener = vi.spyOn(systemTheme, 'removeEventListener');
    const wrapper = mountEffect();
    wrapper.unmount();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    systemTheme.matches = true;
    systemTheme.dispatchEvent(new Event('change'));
    expect(useSettingsStore().theme).toBe('light');
  });

  it('applies the current theme and color tokens immediately', () => {
    initializeSettingsStore(createSettingsFixture({ theme: 'dark' }));
    const settings = useSettingsStore();
    document.documentElement.style.setProperty('--color-bg', 'stale');
    mountEffect();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(settings.themeColors.background);
  });

  it('updates the DOM when the theme changes', async () => {
    initializeSettingsStore(createSettingsFixture({ theme: 'light' }));
    const settings = useSettingsStore();
    mountEffect();
    expect(document.documentElement.dataset.theme).toBe('light');
    settings.setTheme('dark');
    await nextTick();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe(settings.themeColors.background);
  });

  it('updates the primary token when the accent changes', async () => {
    initializeSettingsStore(createSettingsFixture());
    const settings = useSettingsStore();
    mountEffect();
    settings.setAccent('orange');
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(settings.themeColors.primary);
  });

  it('replaces stale managed tokens when the theme changes', async () => {
    initializeSettingsStore(createSettingsFixture());
    const settings = useSettingsStore();
    mountEffect();
    document.documentElement.style.setProperty('--color-overlay', 'stale');
    document.documentElement.style.setProperty('--scrollbar-track', 'stale');
    settings.setTheme('dark');
    await nextTick();
    expect(document.documentElement.style.getPropertyValue('--color-overlay')).toBe(settings.themeColors.overlay);
    expect(document.documentElement.style.getPropertyValue('--scrollbar-track')).toBe(settings.themeColors.scrollbarTrack);
  });
});
