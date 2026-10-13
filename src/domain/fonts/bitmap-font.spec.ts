import { describe, it, expect } from 'vitest';
import body from '@/assets/fonts/insignia15LTaa.fnt?raw';
import heading from '@/assets/fonts/orbitron12condensed.fnt?raw';
import title from '@/assets/fonts/orbitron20aabold.fnt?raw';
import caption from '@/assets/fonts/victor10.fnt?raw';
import op from '@/assets/fonts/orbitron24aabold.fnt?raw';
import pickerTitle from '@/assets/fonts/orbitron20aa.fnt?raw';
import refitButton from '@/assets/fonts/orbitron24aa.fnt?raw';
import slotName from '@/assets/fonts/insignia21LTaa.fnt?raw';
import { parseBitmapFont } from './bitmap-font';
import { layoutText, bitmapInkBounds } from './text-layout';
describe('bundled Chinese original bitmap font layout', () => {
  it.each([
    [body, 17, 15, 6735],
    [heading, 16, 16, 6500],
    [title, 20, 19, 6517],
    [caption, 9, 8, 8082],
    [op, 24, 21, 6516],
    [pickerTitle, 20, 19, 6516],
    [refitButton, 24, 21, 6516],
    [slotName, 18, 16, 6735],
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
    const full = layoutText(font, runs);
    expect(full.width).toBe(full.placements.reduce((sum, item) => sum + item.advance, 0));
    expect(full.placements.at(-1)!.color).toBe('#ffd200');
    const wrapped = layoutText(font, runs, 30);
    expect(wrapped.height).toBeGreaterThan(font.lineHeight);
    expect(wrapped.placements.map((item) => item.character).join('')).toBe('舰船 75');
  });
  it('retains missing Unicode and explicit newlines', () => {
    const font = parseBitmapFont(body),
      result = layoutText(font, [{ text: '舰\n\u{1f680}' }]);
    expect(result.missing).toEqual(['🚀']);
    expect(result.height).toBe(34);
    expect(result.placements[1]!).toMatchObject({ glyph: null, character: '🚀', y: 17 });
  });
  it('uses formal kerning amounts and word wrapping', () => {
    const font = parseBitmapFont(
      'common lineHeight=10 base=8\nchar id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=3 page=0\nchar id=65 x=0 y=0 width=6 height=8 xoffset=0 yoffset=0 xadvance=7 page=0\nchar id=86 x=6 y=0 width=6 height=8 xoffset=0 yoffset=0 xadvance=7 page=0\nkerning first=65 second=86 amount=-2',
    );
    expect(layoutText(font, [{ text: 'AV' }]).width).toBe(12);
    expect(layoutText(font, [{ text: 'A AV' }], 15).placements.at(-1)!.y).toBe(10);
  });
  it('measures visible text ink independently of baseline and whitespace', () => {
    const font = parseBitmapFont(
      'common lineHeight=20 base=16\nchar id=32 x=0 y=0 width=1 height=1 xoffset=0 yoffset=19 xadvance=4 page=0\nchar id=65 x=0 y=0 width=8 height=9 xoffset=0 yoffset=4 xadvance=9 page=0',
    );
    expect(bitmapInkBounds(font, layoutText(font, [{ text: ' A ' }]).placements)).toMatchObject({ top: 4, height: 9 });
    expect(bitmapInkBounds(font, layoutText(font, [{ text: 'A\nA' }]).placements)).toMatchObject({ top: 4, height: 29 });
  });
});
