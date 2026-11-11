import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { LoadTextFilePayload, TextSave, TextBatchSave, TextFileData, FileVersion, WriteResult } from '@/shared/types';

export function loadTextFile(sessionId: string | null, modRoot: string, path: string): Promise<TextFileData> {
  return invokeCommand('load_text_file', { payload: { sessionId, modRoot, path } satisfies LoadTextFilePayload });
}
export function saveTextBatch(payload: TextBatchSave, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('save_text_batch', { payload }, [], request);
}

export function saveTextFile(
  sessionId: string | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: FileVersion[],
  request?: SaveCommandRequest,
): Promise<WriteResult> {
  return invokeSaveCommand('save_text_file', { payload: { baseVersions, sessionId, modRoot, path, text } satisfies TextSave }, [], request);
}
