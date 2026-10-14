import type { BitmapFont, BitmapGlyph } from './font.types';

export function parseBitmapFont(text: string): BitmapFont {
  let lineHeight = 0,
    base = 0,
    width = 0,
    height = 0,
    pageCount = 0;
  const pages = new Map<number, string>();
  const glyphs = new Map<number, BitmapGlyph>(),
    kernings = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const fields = Object.fromEntries([...line.matchAll(/(\w+)=(-?\d+)/g)].map((match) => [match[1]!, Number(match[2])]));
    if (line.startsWith('common ')) {
      lineHeight = fields.lineHeight!;
      base = fields.base!;
      width = fields.scaleW!;
      height = fields.scaleH!;
      pageCount = fields.pages!;
    }
    if (line.startsWith('page ')) {
      const file = /file="([^"]+)"/.exec(line)?.[1];
      if (file) pages.set(fields.id!, file);
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
  return { lineHeight, base, width, height, pageCount, pages, glyphs, kernings };
}

export function parseOriginalBitmapFont(text: string): BitmapFont {
  for (const line of text.split(/\r?\n/).filter((line) => /^(common|char|kerning) /.test(line))) {
    if (
      line.startsWith('kerning ') &&
      ['first', 'second', 'amount'].some((key) => !new RegExp(`(?:^|\\s)${key}=-?\\d+(?:\\s|$)`).test(line))
    )
      throw new Error('Invalid bitmap font kerning fields');
    for (const [, key, value] of line.matchAll(/(\w+)=([^\s]+)/g)) {
      if (
        [
          'lineHeight',
          'base',
          'scaleW',
          'scaleH',
          'pages',
          'id',
          'x',
          'y',
          'width',
          'height',
          'xoffset',
          'yoffset',
          'xadvance',
          'page',
          'first',
          'second',
          'amount',
        ].includes(key!) &&
        !/^-?\d+$/.test(value!)
      )
        throw new Error('Invalid bitmap font integer field');
    }
  }
  const font = parseBitmapFont(text);
  const lines = text.split(/\r?\n/);
  const validPositive = (value: number) => Number.isInteger(value) && value > 0;
  if (
    !validPositive(font.lineHeight) ||
    !Number.isInteger(font.base) ||
    font.base < 0 ||
    !validPositive(font.width) ||
    !validPositive(font.height) ||
    !validPositive(font.pageCount) ||
    font.pages.size !== font.pageCount ||
    !font.glyphs.has(63) ||
    !font.glyphs.has(32) ||
    lines.filter((line) => line.startsWith('common ')).length !== 1 ||
    lines.filter((line) => line.startsWith('page ')).length !== font.pages.size ||
    lines.filter((line) => line.startsWith('char ')).length !== font.glyphs.size
  )
    throw new Error('Invalid bitmap font metrics, pages or required glyphs');
  for (const [id] of font.pages)
    if (!Number.isInteger(id) || id < 0 || id >= font.pageCount) throw new Error('Invalid bitmap font page id');
  for (const glyph of font.glyphs.values()) {
    if (
      !Object.values(glyph).every(Number.isInteger) ||
      !font.pages.has(glyph.page) ||
      glyph.id < 0 ||
      glyph.id > 0x10ffff ||
      glyph.x < 0 ||
      glyph.y < 0 ||
      glyph.width < 0 ||
      glyph.height < 0 ||
      glyph.x + glyph.width > font.width ||
      glyph.y + glyph.height > font.height ||
      glyph.xadvance < 0
    )
      throw new Error('Invalid bitmap font glyph');
  }
  if (![...font.kernings.values()].every(Number.isInteger)) throw new Error('Invalid bitmap font kerning');
  if (font.glyphs.get(63)!.width === 0 || font.glyphs.get(63)!.height === 0 || font.glyphs.get(63)!.xadvance === 0)
    throw new Error('Invalid bitmap font question-mark glyph');
  return font;
}
