import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_FAMILY, generalFontFamily } from './fonts';

describe('general font family', () => {
  it('retains the default stack and quotes selected family names as one CSS family', () => {
    expect(generalFontFamily(null)).toBe(DEFAULT_FONT_FAMILY);
    expect(generalFontFamily('Example, Font')).toBe(`"Example, Font", ${DEFAULT_FONT_FAMILY}`);
    expect(generalFontFamily('Example "Font"')).toBe(`"Example \\"Font\\"", ${DEFAULT_FONT_FAMILY}`);
  });
});
