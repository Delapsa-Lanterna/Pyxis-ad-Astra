import type { FontId } from '@/domain/fonts/font.types';
import type { OriginalFontResult } from '@/shared/types/font.types';

export function bitmapFontFixture(characters = ' ?AV0123舰船名称容器筛选', pages = 1): string {
  return [
    `common lineHeight=10 base=8 scaleW=16 scaleH=16 pages=${pages} packed=0`,
    ...Array.from({ length: pages }, (_, id) => `page id=${id} file="page${id}.png"`),
    ...Array.from(new Set(characters)).map(
      (character, index) =>
        `char id=${character.codePointAt(0)} x=0 y=0 width=6 height=8 xoffset=1 yoffset=1 xadvance=7 page=${index % pages}`,
    ),
    'kerning first=65 second=86 amount=-2',
  ].join('\n');
}

export function originalFontFixture(fontId: FontId = 'insignia15LTaa', pages = 1): Extract<OriginalFontResult, { status: 'available' }> {
  return {
    status: 'available',
    root: 'C:/game',
    fontId,
    path: `C:/game/starsector-core/graphics/fonts/${fontId}.fnt`,
    definition: bitmapFontFixture(undefined, pages),
    pages: Array.from({ length: pages }, (_, id) => ({
      id,
      path: `C:/game/starsector-core/graphics/fonts/page${id}.png`,
      dataUrl: `data:image/png;base64,page${id}`,
    })),
  };
}
