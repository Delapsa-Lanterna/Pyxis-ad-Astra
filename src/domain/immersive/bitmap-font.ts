export type ImmersiveFontRole = 'body' | 'heading' | 'ship-title';
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
  lineHeight: number;
  base: number;
  glyphs: ReadonlyMap<number, BitmapGlyph>;
  kernings: ReadonlyMap<string, number>;
}
export interface BitmapTextRun {
  text: string;
  color?: string;
}
export interface BitmapPlacement {
  glyph: BitmapGlyph | null;
  character: string;
  x: number;
  y: number;
  advance: number;
  color?: string;
}
export function parseBitmapFont(text: string): BitmapFont {
  let lineHeight = 0,
    base = 0;
  const glyphs = new Map<number, BitmapGlyph>(),
    kernings = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const fields = Object.fromEntries([...line.matchAll(/(\w+)=(-?\d+)/g)].map((match) => [match[1]!, Number(match[2])]));
    if (line.startsWith('common ')) {
      lineHeight = fields.lineHeight!;
      base = fields.base!;
    }
    if (line.startsWith('char '))
      glyphs.set(fields.id!, {
        id: fields.id!,
        x: fields.x!,
        y: fields.y!,
        width: fields.width!,
        height: fields.height!,
        xoffset: fields.xoffset!,
        yoffset: fields.yoffset!,
        xadvance: fields.xadvance!,
        page: fields.page!,
      });
    if (line.startsWith('kerning ')) kernings.set(fields.first + ':' + fields.second, fields.amount!);
  }
  return { lineHeight, base, glyphs, kernings };
}
export function layoutBitmapText(font: BitmapFont, runs: readonly BitmapTextRun[], maxWidth = Infinity) {
  const characters = runs.flatMap((run) => Array.from(run.text).map((character) => ({ character, color: run.color })));
  const placements: BitmapPlacement[] = [],
    missing = new Set<string>();
  let x = 0,
    y = 0,
    width = 0,
    previous: number | null = null;
  for (let index = 0; index < characters.length; index++) {
    const { character, color } = characters[index]!;
    if (character === '\r') continue;
    if (character === '\n') {
      width = Math.max(width, x);
      x = 0;
      y += font.lineHeight;
      previous = null;
      continue;
    }
    const id = character.codePointAt(0)!,
      glyph = font.glyphs.get(id) ?? null;
    const advance = character === '\t' ? font.glyphs.get(32)!.xadvance * 4 : (glyph?.xadvance ?? font.lineHeight);
    let kern = previous === null ? 0 : (font.kernings.get(previous + ':' + id) ?? 0);
    if (/[A-Za-z0-9]/.test(character) && (index === 0 || !/[A-Za-z0-9]/.test(characters[index - 1]!.character))) {
      let word = 0,
        last = previous;
      for (let cursor = index; cursor < characters.length && /[A-Za-z0-9]/.test(characters[cursor]!.character); cursor++) {
        const next = characters[cursor]!.character.codePointAt(0)!;
        word += (font.glyphs.get(next)?.xadvance ?? font.lineHeight) + (last === null ? 0 : (font.kernings.get(last + ':' + next) ?? 0));
        last = next;
      }
      if (x > 0 && word <= maxWidth && x + word > maxWidth) {
        width = Math.max(width, x);
        x = 0;
        y += font.lineHeight;
        kern = 0;
      }
    }
    if (x > 0 && x + kern + advance > maxWidth) {
      width = Math.max(width, x);
      x = 0;
      y += font.lineHeight;
      kern = 0;
    }
    x += kern;
    if (!glyph && character !== '\t') missing.add(character);
    placements.push({ glyph, character, x, y, advance, color });
    x += advance;
    previous = id;
  }
  return { placements, width: Math.max(width, x), height: y + font.lineHeight, missing: [...missing] };
}
