import { parseOriginalBitmapFont } from '@/domain/fonts/bitmap-font';
import type { BitmapFont, BitmapGlyph } from '@/domain/fonts/font.types';
import type { OriginalFontResult } from '@/shared/types';
import { createResidentCache } from '@/shared/runtime/resident-cache';
import { AppError } from '@/shared/lib/errors';
import { subscribeCacheLimits, windowCacheLimits } from '@/shared/runtime/cache-limits';
import { debugLog } from '@/shared/runtime/app-log-queue';

const glyphs = new WeakMap<HTMLImageElement, ReturnType<typeof createResidentCache<HTMLCanvasElement>>>();

export interface LoadedFont {
  definition: BitmapFont;
  pages: ReadonlyMap<number, HTMLImageElement>;
}

export async function decodeOriginalFont(source: Extract<OriginalFontResult, { status: 'available' }>): Promise<LoadedFont> {
  debugLog('font.decode_started', () => ({ path: source.path, pages: String(source.pages.length), fontId: source.fontId }));
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
  debugLog('font.decode_completed', () => ({ path: source.path, pages: String(source.pages.length), fontId: source.fontId }));
  return { definition, pages: new Map(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))) };
}

export function acquireFontGlyph(image: HTMLImageElement, glyph: BitmapGlyph, color: string, outline = false) {
  let cache = glyphs.get(image);
  if (!cache) {
    cache = createResidentCache<HTMLCanvasElement>(
      () => ({ entries: windowCacheLimits().fonts.glyphEntriesPerPage, bytes: Infinity }),
      'font-glyphs',
    );
    glyphs.set(image, cache);
    subscribeCacheLimits(cache);
  }
  const key = JSON.stringify([glyph.id, color, outline]);
  const cached = cache.get(key);
  if (cached) return { canvas: cached, release: cache.retain(key) };
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
  cache.put(key, surface, surface.width * surface.height * 4, 1);
  return { canvas: surface, release: () => cache.release(key) };
}
