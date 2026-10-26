import { describe, it, expect } from 'vitest';
import { bitmapFontFixture } from '@/test/fixtures/font';
import { parseBitmapFont, parseOriginalBitmapFont } from './bitmap-font';
import { layoutText, bitmapInkBounds } from './text-layout';

describe('external bitmap font parsing and layout', () => {
  it('parses metrics, page file names, glyphs and kerning', () => {
    const font = parseOriginalBitmapFont(bitmapFontFixture(undefined, 2));
    expect(font).toMatchObject({ lineHeight: 10, base: 8, width: 16, height: 16, pageCount: 2 });
    expect([...font.pages]).toEqual([
      [0, 'page0.png'],
      [1, 'page1.png'],
    ]);
    expect(font.glyphs.get(65)?.page).toBe(0);
    expect(font.kernings.get('65:86')).toBe(-2);
  });
  it.each([
    ['lineHeight=10', 'lineHeight=0'],
    ['pages=1', 'pages=2'],
    ['base=8', 'base=invalid'],
    ['page=0', 'page=2'],
    ['width=6', 'width=40'],
    ['xadvance=7', 'xadvance=invalid'],
    ['amount=-2', 'amount=invalid'],
    ['first=65', 'first=invalid'],
    ['char id=63', 'char id=64'],
    ['char id=32', 'char id=31'],
  ])('rejects invalid external data: %s', (before, after) => {
    expect(() => parseOriginalBitmapFont(bitmapFontFixture().replace(before, after))).toThrow();
  });
  it('retains mixed text, color runs and explicit line breaks', () => {
    const font = parseOriginalBitmapFont(bitmapFontFixture());
    const full = layoutText(font, [{ text: '舰船 ' }, { text: 'AV', color: '#ffd200' }]);
    expect(full.placements.map((item) => item.character).join('')).toBe('舰船 AV');
    expect(full.placements.at(-1)?.color).toBe('#ffd200');
    expect(layoutText(font, [{ text: '舰船 AV' }], 14).height).toBeGreaterThan(font.lineHeight);
  });
  it('intentionally substitutes one question mark per missing grapheme with question-mark kerning', () => {
    const font = parseOriginalBitmapFont(bitmapFontFixture(' ?AV') + '\nkerning first=65 second=63 amount=-1');
    const result = layoutText(font, [{ text: 'A🚀áV' }]);
    expect(result.missing).toEqual(['🚀', 'á']);
    expect(result.placements.map((item) => item.character)).toEqual(['A', '🚀', 'á', 'V']);
    expect(result.placements.map((item) => item.glyph?.id)).toEqual([65, 63, 63, 86]);
    expect(result.placements[1]?.x).toBe(6);
    expect(result.advanceWidth).toBe(27);
  });
  it('wraps missing characters using the rendered question-mark advance', () => {
    const font = parseOriginalBitmapFont(bitmapFontFixture(' ?A'));
    const result = layoutText(font, [{ text: '🚀🚀\nA' }], 7);
    expect(result.placements.map((item) => item.y)).toEqual([0, 10, 20]);
    expect(result.height).toBe(30);
  });
  it('measures visible ink independently of baseline and whitespace', () => {
    const font = parseBitmapFont(
      'common lineHeight=20 base=16\nchar id=32 x=0 y=0 width=1 height=1 xoffset=0 yoffset=19 xadvance=4 page=0\nchar id=65 x=0 y=0 width=8 height=9 xoffset=0 yoffset=4 xadvance=9 page=0',
    );
    expect(bitmapInkBounds(font, layoutText(font, [{ text: ' A ' }]).placements)).toMatchObject({ top: 4, height: 9 });
    expect(bitmapInkBounds(font, layoutText(font, [{ text: 'A\nA' }]).placements)).toMatchObject({ top: 4, height: 29 });
  });
});
