import { describe, expect, it } from 'vitest';
import { applyTextInput, tabLabel, textOffset } from './documents';

describe('code document text and location', () => {
  it.each(['alpha\r\nbeta\ngamma\rdelta', 'alpha\nbeta\ngamma\ndelta', 'alpha\r\nbeta\r\ngamma\r\ndelta'])(
    'retains untouched line endings for %j',
    (original) => {
      const surface = original.replace(/\r\n|\r/g, '\n');
      expect(applyTextInput(original, surface)).toBe(original);
      expect(applyTextInput(original, surface.replace('beta', '中文 beta'))).toBe(original.replace('beta', '中文 beta'));
      expect(applyTextInput(original, surface + '!')).toBe(original + '!');
      expect(applyTextInput(original, surface.slice(1))).toBe(original.slice(1));
    },
  );
  it('maps UTF-16 positions and distinguishes same-name files', () => {
    expect(textOffset('😀\r\nabc\rxyz', 2, 3)).toBe(5);
    expect(textOffset('a', 8, 1)).toBe(1);
    expect(tabLabel('M:/src/a/Entry.java', ['M:/src/a/Entry.java', 'M:/src/b/Entry.java'], 'M:/src')).toBe('a/Entry.java');
  });
  it.each([
    { start: 3, end: 3, caret: 4, next: 'abc!\ndef\nghi', expected: 'abc!\r\ndef\nghi' },
    { start: 4, end: 7, caret: 6, next: 'abc\n中文\nghi', expected: 'abc\r\n中文\nghi' },
    { start: 4, end: 4, caret: 3, next: 'abcdef\nghi', expected: 'abcdef\nghi' },
    { start: 3, end: 3, caret: 3, next: 'abcdef\nghi', expected: 'abcdef\nghi' },
    { start: 2, end: 6, caret: 4, next: 'ab😀f\nghi', expected: 'ab😀f\nghi' },
    { start: 4, end: 4, caret: 5, next: 'abc\n\ndef\nghi', expected: 'abc\r\n\r\ndef\nghi' },
  ])('retains original newline boundaries with native selection $start/$end/$caret', ({ next, expected, ...selection }) => {
    expect(applyTextInput('abc\r\ndef\nghi', next, selection)).toBe(expected);
  });
  it('accepts full LF input and maps Unicode deletion without a scan over unchanged characters', () => {
    const text = 'x'.repeat(10 * 1024 * 1024);
    expect(applyTextInput(text, text + '!')).toBe(text + '!');
    expect(applyTextInput('😀\r\nnext', '\nnext', { start: 2, end: 2, caret: 0 })).toBe('\r\nnext');
    expect(applyTextInput('first\r\nsecond\nthird\rfinal', 'first\n中文 second\nthird\nfinal', { start: 0, end: 24, caret: 26 })).toBe(
      'first\r\n中文 second\nthird\rfinal',
    );
  });
});
