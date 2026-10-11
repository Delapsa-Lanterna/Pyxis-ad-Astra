import { createThemeColors, type ThemeColorTokens } from '@/domain/settings/theme';

export const IMMERSIVE_COLORS: ThemeColorTokens = {
  ...createThemeColors('#9acbd8', 'dark'),
  background: '#050809',
  panel: '#0b1215',
  panelMuted: '#153f4b',
  surface: '#102027',
  surfaceHover: '#19323c',
  surfaceActive: '#22434e',
  border: '#28505c',
  borderStrong: '#7bb8c9',
  text: '#eceeed',
  textSoft: '#cbd1d0',
  muted: '#93a6ac',
  warning: '#ffe600',
  success: '#00dcb2',
  onPrimary: '#071115',
};

export const IMMERSIVE_APPEARANCE_NOTE = '沉浸式编辑器固定采用原版暗色外观。统计为基础配置，插件效果按零效果计算。';
