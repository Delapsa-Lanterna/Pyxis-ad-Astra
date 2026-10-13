import type { BitmapFont, BitmapGlyph } from './font.types';

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
