import { createApp, h, watch, type CSSProperties } from 'vue';
import { ACCENT_PRESETS, createThemeColors, THEME_TOKEN_MAP } from '@/domain/settings/theme';
import BrowserAppearance, { type BrowserAppearanceState } from './BrowserAppearance.vue';
import type { createBrowserHost } from './host';

export function browserThemeStyle(settings: BrowserAppearanceState): CSSProperties {
  const accent = settings.accent === 'custom' ? settings.customAccent : ACCENT_PRESETS.find(({ value }) => value === settings.accent)!.hex;
  const colors = createThemeColors(accent, settings.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  return Object.fromEntries(Object.entries(THEME_TOKEN_MAP).map(([key, field]) => [key, colors[field]]));
}

export function mountSceneAppearance(element: HTMLElement, host: ReturnType<typeof createBrowserHost>) {
  return createApp({
    setup() {
      const settings = host.settings;
      watch(
        () => [settings.theme, settings.accent, settings.customAccent] as const,
        () => {
          for (const [key, value] of Object.entries(
            browserThemeStyle({ theme: settings.theme, accent: settings.accent, customAccent: settings.customAccent }),
          ))
            element.closest<HTMLElement>('.browser-chrome')!.style.setProperty(key, String(value));
        },
        { immediate: true },
      );
      return () => h(BrowserAppearance, { settings, onChange: host.setAppearance });
    },
  });
}
