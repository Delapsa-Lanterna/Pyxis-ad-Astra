import insignia15LTaa from '@/assets/fonts/insignia15LTaa.fnt?raw';
import insignia15LTaaAtlas from '@/assets/fonts/insignia15LTaa_0.png';
import insignia21LTaa from '@/assets/fonts/insignia21LTaa.fnt?raw';
import insignia21LTaaAtlas from '@/assets/fonts/insignia21LTaa_0.png';
import orbitron12condensed from '@/assets/fonts/orbitron12condensed.fnt?raw';
import orbitron12condensedAtlas from '@/assets/fonts/orbitron12condensed_0.png';
import orbitron20aa from '@/assets/fonts/orbitron20aa.fnt?raw';
import orbitron20aaAtlas from '@/assets/fonts/orbitron20aa_0.png';
import orbitron20aabold from '@/assets/fonts/orbitron20aabold.fnt?raw';
import orbitron20aaboldAtlas from '@/assets/fonts/orbitron20aabold_0.png';
import orbitron24aa from '@/assets/fonts/orbitron24aa.fnt?raw';
import orbitron24aaAtlas from '@/assets/fonts/orbitron24aa_0.png';
import orbitron24aabold from '@/assets/fonts/orbitron24aabold.fnt?raw';
import orbitron24aaboldAtlas from '@/assets/fonts/orbitron24aabold_0.png';
import victor10 from '@/assets/fonts/victor10.fnt?raw';
import victor10Atlas from '@/assets/fonts/victor10_0.png';
import victor14 from '@/assets/fonts/victor14.fnt?raw';
import victor14Atlas from '@/assets/fonts/victor14_0.png';
import type { FontId } from '@/domain/fonts/font.types';

export const bundledFonts = {
  insignia15LTaa: { definition: insignia15LTaa, atlas: insignia15LTaaAtlas },
  insignia21LTaa: { definition: insignia21LTaa, atlas: insignia21LTaaAtlas },
  orbitron12condensed: { definition: orbitron12condensed, atlas: orbitron12condensedAtlas },
  orbitron20aa: { definition: orbitron20aa, atlas: orbitron20aaAtlas },
  orbitron20aabold: { definition: orbitron20aabold, atlas: orbitron20aaboldAtlas },
  orbitron24aa: { definition: orbitron24aa, atlas: orbitron24aaAtlas },
  orbitron24aabold: { definition: orbitron24aabold, atlas: orbitron24aaboldAtlas },
  victor10: { definition: victor10, atlas: victor10Atlas },
  victor14: { definition: victor14, atlas: victor14Atlas },
} satisfies Record<FontId, { definition: string; atlas: string }>;
