import { parseOriginalBitmapFont } from '@/domain/fonts/bitmap-font';
import type { BitmapFont, BitmapGlyph } from '@/domain/fonts/font.types';
import type { OriginalFontResult } from '@/shared/types';
import { createRuntimeCache, type RuntimeCache } from '@/shared/runtime/cache';
import { AppError } from '@/shared/lib/errors';
import { windowCacheLimits } from '@/shared/runtime/cache-limits';

const glyphs = new WeakMap<HTMLImageElement, RuntimeCache<string, HTMLCanvasElement, never>>();

export interface LoadedFont {
  definition: BitmapFont;
  pages: ReadonlyMap<number, HTMLImageElement>;
}

export async function decodeOriginalFont(source: Extract<OriginalFontResult, { status: 'available' }>): Promise<LoadedFont> {
  let definition: BitmapFont;
  try {
    definition = parseOriginalBitmapFont(source.definition);
  } catch (cause) {
    throw new AppError('Invalid original font definition', {
      cause,
      code: 'font.definition_invalid',
      location: { path: source.path, line: null, column: null },
      action: 'font-load',
    });
  }
  if (
    source.pages.length !== definition.pages.size ||
    new Set(source.pages.map((page) => page.id)).size !== source.pages.length ||
    source.pages.some((page) => !definition.pages.has(page.id))
  )
    throw new AppError('Invalid original font page collection', {
      code: 'font.definition_invalid',
      location: { path: source.path, line: null, column: null },
      action: 'font-load',
    });
  const results = await Promise.allSettled(
    source.pages.map(async (page) => {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          image.onload = null;
          image.onerror = null;
          resolve(image);
        };
        image.onerror = () => {
          image.onload = null;
          image.onerror = null;
          reject(
            new AppError('Original font page decode failed', {
              code: 'font.decode_failed',
              location: { path: page.path, line: null, column: null },
              action: 'font-load',
            }),
          );
        };
        image.src = page.dataUrl;
      });
      if (image.naturalWidth !== definition.width || image.naturalHeight !== definition.height)
        throw new AppError('Original font page dimensions do not match its definition', {
          code: 'font.definition_invalid',
          location: { path: page.path, line: null, column: null },
          action: 'font-load',
        });
      return [page.id, image] as const;
    }),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return { definition, pages: new Map(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))) };
}

export function fontGlyph(image: HTMLImageElement, glyph: BitmapGlyph, color: string, outline = false): HTMLCanvasElement {
  let cache = glyphs.get(image);
  if (!cache) {
    cache = createRuntimeCache<string, HTMLCanvasElement>({ capacity: () => windowCacheLimits().fonts.glyphEntriesPerPage });
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
