import type { ThemeColorTokens } from '@/domain/settings/theme';

export interface CanvasPalette {
  background: string;
  grid: string;
  highlight: string;
  marker: string;
  outline: string;
}

export function createCanvasPalette(colors: ThemeColorTokens): CanvasPalette {
  return {
    background: colors.panelMuted,
    grid: colors.border,
    highlight: colors.primary,
    marker: '#ffffff',
    outline: '#000000',
  };
}
