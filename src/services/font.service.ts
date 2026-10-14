import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { FontId } from '@/domain/fonts/font.types';
import type { OriginalFontResult } from '@/shared/types';

export function queryOriginalFont(sessionId: string, starsectorRoot: string | null, fontId: FontId): Promise<OriginalFontResult> {
  return invokeCommand('query_original_font', { payload: { sessionId, starsectorRoot, fontId } });
}
