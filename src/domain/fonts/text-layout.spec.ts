import { describe, expect, it } from 'vitest';
import { parseBitmapFont } from './bitmap-font';
import { layoutText, textGraphemes } from './text-layout';

const characters = Array.from(' AVabcd0123舰船中文（），。');
const font = parseBitmapFont(
  'common lineHeight=10 base=8\n' +
    characters
      .map((character) => `char id=${character.codePointAt(0)} x=0 y=0 width=6 height=8 xoffset=0 yoffset=1 xadvance=7 page=0`)
      .join('\n') +
    '\nkerning first=65 second=86 amount=-2',
);

describe('shared text layout boundaries', () => {
  it('keeps kerning and words continuous across color runs', () => {
    const split = layoutText(font, [{ text: '中A' }, { text: 'V', color: '#ffd200' }], 14);
    const single = layoutText(font, [{ text: '中AV' }], 14);
    expect(split.placements.map(({ x, y }) => ({ x, y }))).toEqual(single.placements.map(({ x, y }) => ({ x, y })));
    expect(split.placements.at(-1)).toMatchObject({ x: 5, y: 10, color: '#ffd200' });
  });

  it('splits overlong words while making progress in a one-pixel container', () => {
    const result = layoutText(font, [{ text: 'abcd中文' }], 1);
    expect(result.placements).toHaveLength(6);
    expect(result.placements.map(({ y }) => y)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(result.height).toBe(60);
  });

  it('keeps common opening and closing punctuation with adjacent text when it fits', () => {
    const result = layoutText(font, [{ text: '中（文）' }], 21);
    expect(result.placements.map(({ y }) => y)).toEqual([0, 10, 10, 10]);
    expect(layoutText(font, [{ text: '中文，' }], 14).placements.map(({ y }) => y)).toEqual([0, 10, 10]);
    expect(layoutText(font, [{ text: 'abcd，' }], 14).placements.map(({ y }) => y)).toEqual([0, 0, 10, 20, 20]);
  });

  it('keeps combining and emoji sequences atomic across run boundaries', () => {
    const result = layoutText(font, [{ text: 'a' }, { text: '\u0301' }, { text: '👨‍👩‍👧‍👦舰' }], 1);
    expect(result.placements.map(({ character }) => character)).toEqual(['á', '👨‍👩‍👧‍👦', '舰']);
    expect(result.missing).toEqual(['á', '👨‍👩‍👧‍👦']);
    expect(textGraphemes('á👨‍👩‍👧‍👦')).toHaveLength(2);
  });

  it('retains whitespace and explicit CRLF, CR and LF line breaks', () => {
    const result = layoutText(font, [{ text: ' A\t\r\n\r\nV\r舰\n' }]);
    expect(result.placements.map(({ character }) => character)).toEqual([' ', 'A', '\t', 'V', '舰']);
    expect(result.placements.map(({ y }) => y)).toEqual([0, 0, 0, 20, 30]);
    expect(result.height).toBe(50);
    expect(result.missing).toEqual([]);
  });

  it('accounts for negative offsets and ink extending beyond advances', () => {
    const overhang = parseBitmapFont(
      'common lineHeight=10 base=8\nchar id=65 x=0 y=0 width=12 height=14 xoffset=-2 yoffset=-3 xadvance=7 page=0',
    );
    const result = layoutText(overhang, [{ text: 'A' }]);
    expect(result.advanceWidth).toBe(7);
    expect(result.width).toBe(12);
    expect(result.ink).toEqual({ left: -2, top: -3, right: 10, bottom: 11, width: 12, height: 14 });
  });

  it('handles empty runs and exposes an empty layout', () => {
    expect(layoutText(font, [{ text: '' }, { text: 'A' }, { text: '' }]).placements).toHaveLength(1);
    expect(layoutText(font, []).placements).toEqual([]);
    expect(layoutText(font, []).width).toBe(0);
  });
});
