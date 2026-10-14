import type { FontId } from './font.types';

export const fontDefaultStyles = {
  insignia15LTaa: { size: 15, weight: 400 },
  insignia21LTaa: { size: 21, weight: 400 },
  orbitron12condensed: { size: 12, weight: 400 },
  orbitron20aa: { size: 20, weight: 400 },
  orbitron20aabold: { size: 20, weight: 700 },
  orbitron24aa: { size: 24, weight: 400 },
  orbitron24aabold: { size: 24, weight: 700 },
  victor10: { size: 10, weight: 400 },
  victor14: { size: 14, weight: 400 },
} satisfies Record<FontId, { size: number; weight: number }>;
