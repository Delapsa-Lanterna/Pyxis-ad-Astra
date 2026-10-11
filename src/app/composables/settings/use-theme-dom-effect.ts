import { onUnmounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { THEME_TOKEN_MAP, type ThemeColorTokens } from '@/domain/settings/theme';
import type { AppTheme } from '@/shared/types';

// Sole owner of the theme DOM side effect: the store only holds state, this effect
// writes theme tokens to the document. Mounted by the single WindowShell so the main
// window and child windows all pick it up.
export function useThemeDomEffect(source?: () => { colors: ThemeColorTokens; theme: AppTheme }) {
  const settings = useSettingsStore();
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const updateSystemTheme = () => settings.setSystemTheme(systemTheme.matches ? 'dark' : 'light');
  updateSystemTheme();
  systemTheme.addEventListener('change', updateSystemTheme);
  onUnmounted(() => systemTheme.removeEventListener('change', updateSystemTheme));
  watch(
    () => source?.() ?? { colors: settings.themeColors, theme: settings.theme },
    ({ colors, theme }) => {
      if (typeof document === 'undefined') return;
      document.documentElement.dataset.theme = theme;
      applyThemeColors(colors);
    },
    { immediate: true },
  );
}

function applyThemeColors(colors: ThemeColorTokens) {
  const root = document.documentElement;
  for (const key of Object.keys(THEME_TOKEN_MAP)) root.style.removeProperty(key);
  for (const [key, field] of Object.entries(THEME_TOKEN_MAP)) {
    root.style.setProperty(key, colors[field]);
  }
}
