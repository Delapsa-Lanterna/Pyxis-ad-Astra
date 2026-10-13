import type { FontId } from '@/domain/fonts/font.types';

export const immersiveFontIds = {
  body: 'insignia15LTaa',
  heading: 'orbitron12condensed',
  'ship-title': 'orbitron20aabold',
  caption: 'victor10',
  op: 'orbitron24aabold',
  'picker-title': 'orbitron20aa',
  'refit-button': 'orbitron24aa',
  'slot-name': 'insignia21LTaa',
  filter: 'victor14',
} as const satisfies Record<string, FontId>;

export type ImmersiveFontRole = keyof typeof immersiveFontIds;
