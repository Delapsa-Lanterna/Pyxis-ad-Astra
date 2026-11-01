import { describe, expect, it } from 'vitest';
import { parseCsvClipboard, renderCsvClipboard } from './csv-clipboard';

describe('CSV spreadsheet clipboard', () => {
  it.each([
    [
      ['001', '', '  name  '],
      ['-1.50', '=value', '中文'],
    ],
    [['a\tb', 'a\nb', 'a\r\nb', '"quoted"']],
    [[''], ['']],
  ])('round trips exact values %j', (...rows) => {
    expect(parseCsvClipboard(renderCsvClipboard(rows))).toEqual(rows);
  });
  it.each([
    [
      'a\tb\r\nc\td\r\n',
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ],
    [
      'a\t\n\t\n',
      [
        ['a', ''],
        ['', ''],
      ],
    ],
    [
      'a\nb\tc',
      [
        ['a', ''],
        ['b', 'c'],
      ],
    ],
  ])('parses external text %s', (text, expected) => {
    expect(parseCsvClipboard(text as string)).toEqual(expected);
  });
  it.each(['"unfinished', '"closed"extra'])('rejects malformed quoted content %s', (text) => {
    expect(() => parseCsvClipboard(text)).toThrow();
  });
});
