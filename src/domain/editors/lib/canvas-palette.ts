import type { ThemeColorTokens } from '@/domain/settings/theme';

export interface CanvasPalette {
  background: string;
  fontFamily: string;
  grid: string;
  highlight: string;
  marker: string;
  outline: string;
}

export function createCanvasPalette(colors: ThemeColorTokens, fontFamily: string): CanvasPalette {
  return {
    background: colors.panelMuted,
    fontFamily,
    grid: colors.border,
    highlight: colors.primary,
    marker: '#ffffff',
    outline: '#000000',
  };
}
