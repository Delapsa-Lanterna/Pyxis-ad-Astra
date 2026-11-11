import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERFACE_FONT_FAMILY,
  DEFAULT_FIELD_FONT_FAMILY,
  DEFAULT_TEXT_EDITOR_FONT_FAMILY,
  DEFAULT_CANVAS_EDITOR_FONT_FAMILY,
  fontFamily,
} from './fonts';

describe('font families', () => {
  it.each([
    [DEFAULT_INTERFACE_FONT_FAMILY, "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"],
    [DEFAULT_FIELD_FONT_FAMILY, "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace"],
    [DEFAULT_TEXT_EDITOR_FONT_FAMILY, "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace"],
    [DEFAULT_CANVAS_EDITOR_FONT_FAMILY, 'sans-serif'],
  ])('retains %s and quotes selected family names as one CSS family', (defaults, expected) => {
    expect(fontFamily(null, defaults)).toBe(expected);
    expect(fontFamily('Example, Font', defaults)).toBe('"Example, Font", ' + expected);
    expect(fontFamily('Example "Font"', defaults)).toBe('"Example \\"Font\\"", ' + expected);
  });
});
