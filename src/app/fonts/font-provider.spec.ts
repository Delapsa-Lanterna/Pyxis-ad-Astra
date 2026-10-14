import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontGlyph, decodeOriginalFont } from './font-provider';
import { parseOriginalBitmapFont } from '@/domain/fonts/bitmap-font';
import { originalFontFixture } from '@/test/font';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function images() {
  const created: Array<{
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    onload: null | (() => void);
    onerror: null | (() => void);
  }> = [];
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 16;
      naturalHeight = 16;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      constructor() {
        created.push(this);
      }
    },
  );
  return created;
}
describe('external font decode', () => {
  it('decodes every declared page before publishing a font', async () => {
    const created = images();
    const loading = decodeOriginalFont(originalFontFixture(undefined, 2));
    expect(created).toHaveLength(2);
    created[0]!.onload!();
    created[1]!.onload!();
    const font = await loading;
    expect([...font.pages.values()]).toEqual(created);
    expect(created.every((image) => image.onload === null && image.onerror === null)).toBe(true);
  });
  it('reports the failed page path and supports a fresh loading attempt', async () => {
    const created = images(),
      source = originalFontFixture(undefined, 2);
    const failed = decodeOriginalFont(source);
    const rejected = expect(failed).rejects.toMatchObject({ code: 'font.decode_failed', location: { path: source.pages[1]!.path } });
    created[0]!.onload!();
    created[1]!.onerror!();
    await rejected;
    const retry = decodeOriginalFont(source);
    created.slice(2).forEach((image) => image.onload!());
    expect((await retry).pages.size).toBe(2);
  });
  it('rejects malformed definitions, duplicate pages and mismatched image dimensions', async () => {
    const created = images(),
      source = originalFontFixture();
    await expect(decodeOriginalFont({ ...source, definition: 'invalid' })).rejects.toMatchObject({
      code: 'font.definition_invalid',
      location: { path: source.path },
    });
    await expect(decodeOriginalFont({ ...source, pages: [] })).rejects.toMatchObject({ code: 'font.definition_invalid' });
    const duplicate = originalFontFixture(undefined, 2);
    duplicate.pages[1]!.id = 0;
    await expect(decodeOriginalFont(duplicate)).rejects.toMatchObject({ code: 'font.definition_invalid' });
    const loading = decodeOriginalFont(source);
    created[0]!.naturalWidth = 20;
    created[0]!.onload!();
    await expect(loading).rejects.toMatchObject({ code: 'font.definition_invalid', location: { path: source.pages[0]!.path } });
  });
});
describe('glyph raster ownership', () => {
  function context() {
    const paint = { drawImage: vi.fn(), fillRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paint as unknown as CanvasRenderingContext2D);
    return paint;
  }
  it('shares glyph/color rasters and isolates outlines and page identities', () => {
    const paint = context(),
      source = originalFontFixture(),
      glyph = parseOriginalBitmapFont(source.definition).glyphs.get(65)!;
    const image = new Image(),
      first = fontGlyph(image, glyph, '#ffd200');
    expect(fontGlyph(image, glyph, '#ffd200')).toBe(first);
    expect(paint.fillRect).toHaveBeenCalledOnce();
    expect(fontGlyph(image, glyph, '#000000', true)).not.toBe(first);
    expect(fontGlyph(new Image(), glyph, '#ffd200')).not.toBe(first);
  });
  it('evicts the oldest raster beyond 512 entries', () => {
    context();
    const image = new Image(),
      glyph = parseOriginalBitmapFont(originalFontFixture().definition).glyphs.get(65)!;
    const first = fontGlyph(image, { ...glyph, id: 0 }, '#fff');
    for (let id = 1; id <= 512; id++) fontGlyph(image, { ...glyph, id }, '#fff');
    expect(fontGlyph(image, { ...glyph, id: 0 }, '#fff')).not.toBe(first);
  });
});
