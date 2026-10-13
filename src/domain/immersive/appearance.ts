import { createThemeColors, type ThemeColorTokens } from '@/domain/settings/theme';

export const IMMERSIVE_COLORS: ThemeColorTokens = {
  ...createThemeColors('#aadeff', 'dark'),
  background: '#050809',
  panel: '#0b1215',
  panelMuted: 'rgba(31,94,112,0.6862745098)',
  surface: '#102027',
  surfaceHover: '#19323c',
  surfaceActive: '#22434e',
  border: '#28505c',
  borderStrong: '#7bb8c9',
  text: '#dcdcdc',
  textSoft: '#cbd1d0',
  muted: '#93a6ac',
  warning: '#ffd200',
  success: '#00e1a0',
  dangerHighlight: '#ff7d19',
  onPrimary: '#071115',
};

export const IMMERSIVE_APPEARANCE_NOTE = '沉浸式编辑器固定采用原版暗色外观。统计为基础配置，插件效果按零效果计算。';
export const VARIANT_COLORS = {
  positive: '#9bff00',
  value: '#ffd200',
  opGradient: 'linear-gradient(#1c75b9,#1cbeff 50%,#1c70b1)',
  opTrack: '#000000',
  opOverflow: 'rgba(255,0,0,0.7843137255)',
};
