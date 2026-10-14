export type { FontId } from '@/shared/types';

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
  readonly pages: ReadonlyMap<number, string>;
  readonly width: number;
  readonly height: number;
  readonly pageCount: number;
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
  missing?: boolean;
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
