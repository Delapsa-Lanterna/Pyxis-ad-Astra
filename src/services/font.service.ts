import type { QueryOriginalFontPayload, FontId, OriginalFontResult } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function queryOriginalFont(sessionId: string, starsectorRoot: string | null, fontId: FontId): Promise<OriginalFontResult> {
  return invokeCommand('query_original_font', { payload: { sessionId, starsectorRoot, fontId } satisfies QueryOriginalFontPayload });
}
