import type { LoadTextFilePayload, TextSave, TextTranscode, FollowTextIdentityPayload, EntityKind } from '@/shared/types';
import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { TextFileData, FileVersion, WriteResult } from '@/shared/types';

export function loadTextFile(sessionId: string | null, modRoot: string, path: string): Promise<TextFileData> {
  return invokeCommand('load_text_file', { payload: { sessionId, modRoot, path } satisfies LoadTextFilePayload });
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

export function transcodeFileToUtf8(
  sessionId: string | null,
  modRoot: string,
  path: string,
  encoding: string,
  baseVersions: FileVersion[] = [],
): Promise<WriteResult> {
  return invokeSaveCommand('transcode_file_to_utf8', {
    payload: { baseVersions, sessionId, modRoot, path, encoding } satisfies TextTranscode,
  });
}

export function followTextIdentity(kind: EntityKind, text: string, nextId: string): Promise<string> {
  return invokeCommand('follow_text_identity', { payload: { kind, text, nextId } satisfies FollowTextIdentityPayload });
}
