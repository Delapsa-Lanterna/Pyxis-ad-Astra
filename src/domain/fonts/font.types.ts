export type FontId =
  | 'insignia15LTaa'
  | 'insignia21LTaa'
  | 'orbitron12condensed'
  | 'orbitron20aa'
  | 'orbitron20aabold'
  | 'orbitron24aa'
  | 'orbitron24aabold'
  | 'victor10'
  | 'victor14';

export interface TextRun {
  text: string;
  color?: string;
}

export interface BitmapGlyph {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page: number;
}

export interface BitmapFont {
  readonly lineHeight: number;
  readonly base: number;
  readonly glyphs: ReadonlyMap<number, BitmapGlyph>;
  readonly kernings: ReadonlyMap<string, number>;
}

export interface BitmapPlacement {
  glyph: BitmapGlyph | null;
  character: string;
  x: number;
  y: number;
  advance: number;
  color?: string;
}

export interface TextBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TextLayout {
  placements: BitmapPlacement[];
  advanceWidth: number;
  width: number;
  height: number;
  ink: TextBounds;
  missing: string[];
}
