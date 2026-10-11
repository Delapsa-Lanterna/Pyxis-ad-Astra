import { describe, it, expect } from 'vitest';
import body from '@/assets/immersive/fonts/insignia15LTaa.fnt?raw';
import heading from '@/assets/immersive/fonts/orbitron12condensed.fnt?raw';
import title from '@/assets/immersive/fonts/orbitron20aabold.fnt?raw';
import { parseBitmapFont, layoutBitmapText } from './bitmap-font';
describe('bundled Chinese original bitmap font layout', () => {
  it.each([
    [body, 17, 15, 6735],
    [heading, 16, 16, 6500],
    [title, 20, 19, 6517],
  ])('parses real glyphs, metrics and kerning', (raw, height, base, count) => {
    const font = parseBitmapFont(raw as string);
    expect(font.lineHeight).toBe(height);
    expect(font.base).toBe(base);
    expect(font.glyphs.size).toBe(count);
    expect(font.glyphs.has('舰'.codePointAt(0)!)).toBe(true);
    expect(font.glyphs.has(65)).toBe(true);
  });
  it('lays out mixed text, preserves color runs and wraps using advances', () => {
    const font = parseBitmapFont(body),
      runs = [{ text: '舰船 ' }, { text: '75', color: '#ffd200' }];
    const full = layoutBitmapText(font, runs);
    expect(full.width).toBe(full.placements.reduce((sum, item) => sum + item.advance, 0));
    expect(full.placements.at(-1)!.color).toBe('#ffd200');
    const wrapped = layoutBitmapText(font, runs, 30);
    expect(wrapped.height).toBeGreaterThan(font.lineHeight);
    expect(wrapped.placements.map((item) => item.character).join('')).toBe('舰船 75');
  });
  it('retains missing Unicode and explicit newlines', () => {
    const font = parseBitmapFont(body),
      result = layoutBitmapText(font, [{ text: '舰\n\u{1f680}' }]);
    expect(result.missing).toEqual(['🚀']);
    expect(result.height).toBe(34);
    expect(result.placements[1]!).toMatchObject({ glyph: null, character: '🚀', y: 17 });
  });
  it('uses formal kerning amounts and word wrapping', () => {
    const font = parseBitmapFont(
      'common lineHeight=10 base=8\nchar id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=3 page=0\nchar id=65 x=0 y=0 width=6 height=8 xoffset=0 yoffset=0 xadvance=7 page=0\nchar id=86 x=6 y=0 width=6 height=8 xoffset=0 yoffset=0 xadvance=7 page=0\nkerning first=65 second=86 amount=-2',
    );
    expect(layoutBitmapText(font, [{ text: 'AV' }]).width).toBe(12);
    expect(layoutBitmapText(font, [{ text: 'A AV' }], 15).placements.at(-1)!.y).toBe(10);
  });
});
