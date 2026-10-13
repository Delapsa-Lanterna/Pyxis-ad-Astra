import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontGlyph, getFont, loadFontAtlas } from './font-provider';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shared glyph raster cache', () => {
  it('loads the original victor14 filter metrics and mixed Chinese/Latin glyphs', () => {
    expect(getFont('victor14').lineHeight).toBe(13);
    expect(getFont('victor14').base).toBe(10);
    for (const character of '实弹能量导弹小型中型大型Ctrl') expect(getFont('victor14').glyphs.has(character.codePointAt(0)!)).toBe(true);
  });
  it('reuses the same glyph/color raster and isolates outline and atlas identity', () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalCompositeOperation: 'source-over' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const image = new Image(),
      glyph = getFont('insignia15LTaa').glyphs.get('舰'.codePointAt(0)!)!;
    const first = fontGlyph(image, glyph, '#ffd200');
    expect(fontGlyph(image, glyph, '#ffd200')).toBe(first);
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(fontGlyph(image, glyph, '#000000', true)).not.toBe(first);
    expect(fontGlyph(new Image(), glyph, '#ffd200')).not.toBe(first);
  });
  it('evicts the oldest raster after 512 distinct entries', () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const image = new Image(),
      base = getFont('insignia15LTaa').glyphs.get('舰'.codePointAt(0)!)!;
    const first = fontGlyph(image, { ...base, id: 0 }, '#ffd200');
    for (let id = 1; id <= 512; id++) fontGlyph(image, { ...base, id }, '#ffd200');
    expect(fontGlyph(image, { ...base, id: 0 }, '#ffd200')).not.toBe(first);
  });
});

describe('font definitions and atlas lifecycle', () => {
  it.each([
    ['insignia15LTaa', 17, 15, 6735],
    ['insignia21LTaa', 18, 16, 6735],
    ['orbitron12condensed', 16, 16, 6500],
    ['orbitron20aa', 20, 19, 6516],
    ['orbitron20aabold', 20, 19, 6517],
    ['orbitron24aa', 24, 21, 6516],
    ['orbitron24aabold', 24, 21, 6516],
    ['victor10', 9, 8, 8082],
    ['victor14', 13, 10, 8038],
  ] as const)('provides %s synchronously and shares its definition', (id, lineHeight, base, glyphCount) => {
    const font = getFont(id);
    expect(getFont(id)).toBe(font);
    expect(font).toMatchObject({ lineHeight, base });
    expect(font.glyphs.size).toBe(glyphCount);
  });

  function images() {
    const created: Array<{ src: string; onload: () => void; onerror: () => void }> = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload = () => {};
        onerror = () => {};
        constructor() {
          created.push(this);
        }
      },
    );
    return created;
  }

  it('shares a pending decode and reuses the decoded atlas', async () => {
    const created = images();
    const first = loadFontAtlas('orbitron20aa');
    expect(loadFontAtlas('orbitron20aa')).toBe(first);
    expect(created).toHaveLength(1);
    expect(created[0]!.src).toContain('orbitron20aa_0.png');
    created[0]!.onload();
    expect(await first).toBe(created[0]);
    expect(loadFontAtlas('orbitron20aa')).toBe(first);
  });

  it('retries after a failed decode with the same font identity', async () => {
    const created = images();
    const failed = loadFontAtlas('victor14');
    const rejected = expect(failed).rejects.toMatchObject({
      code: 'font.decode_failed',
      action: 'font-load',
      message: expect.stringContaining('victor14'),
    });
    created[0]!.onerror();
    await rejected;
    const retry = loadFontAtlas('victor14');
    expect(retry).not.toBe(failed);
    expect(created).toHaveLength(2);
    created[1]!.onload();
    expect(await retry).toBe(created[1]);
  });

  it('isolates actual font identities', async () => {
    const created = images();
    const first = loadFontAtlas('orbitron24aa');
    const second = loadFontAtlas('orbitron24aabold');
    expect(first).not.toBe(second);
    expect(created).toHaveLength(2);
    created.forEach((image) => image.onload());
    expect(await first).not.toBe(await second);
  });
});
