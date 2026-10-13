import { bundledFonts } from './bundled-fonts';
import { parseBitmapFont } from '@/domain/fonts/bitmap-font';
import type { FontId, BitmapFont, BitmapGlyph } from '@/domain/fonts/font.types';
import { createRuntimeCache, type RuntimeCache } from '@/shared/runtime/cache';
import { AppError } from '@/shared/lib/errors';

const definitions = new Map<FontId, BitmapFont>();
const decoded = new Map<FontId, Promise<HTMLImageElement>>();
const glyphs = new WeakMap<HTMLImageElement, RuntimeCache<string, HTMLCanvasElement, never>>();

export function getFont(id: FontId): BitmapFont {
  let font = definitions.get(id);
  if (!font) {
    font = parseBitmapFont(bundledFonts[id].definition);
    definitions.set(id, font);
  }
  return font;
}

export function fontGlyph(image: HTMLImageElement, glyph: BitmapGlyph, color: string, outline = false): HTMLCanvasElement {
  let cache = glyphs.get(image);
  if (!cache) {
    cache = createRuntimeCache<string, HTMLCanvasElement>({ capacity: 512 });
    glyphs.set(image, cache);
  }
  const key = JSON.stringify([glyph.id, color, outline]);
  const cached = cache.get(key);
  if (cached) return cached;
  const surface = document.createElement('canvas');
  surface.width = Math.max(1, glyph.width);
  surface.height = Math.max(1, glyph.height);
  const paint = surface.getContext('2d')!;
  paint.drawImage(image, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
  paint.globalCompositeOperation = outline ? 'source-in' : 'multiply';
  paint.fillStyle = color;
  paint.fillRect(0, 0, glyph.width, glyph.height);
  if (!outline) {
    paint.globalCompositeOperation = 'destination-in';
    paint.drawImage(image, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
  }
  cache.set(key, surface);
  return surface;
}
export function loadFontAtlas(id: FontId): Promise<HTMLImageElement> {
  let promise = decoded.get(id);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        decoded.delete(id);
        reject(new AppError(`字体图集解码失败：${id}`, { action: 'font-load', code: 'font.decode_failed' }));
      };
      image.src = bundledFonts[id].atlas;
    });
    decoded.set(id, promise);
  }
  return promise;
}
