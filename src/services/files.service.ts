import type { LoadEditableFilePayload, TextSave, TextTranscode, FollowTextIdentityPayload, EntityKind } from '@/shared/types';
import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { EditableFileData, FileVersion, WriteResult } from '@/shared/types';

export function loadEditableFileData(sessionId: string | null, modRoot: string, path: string): Promise<EditableFileData> {
  return invokeCommand('load_editable_file', { payload: { sessionId, modRoot, path } satisfies LoadEditableFilePayload });
}

export function writeEditableFileText(
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

export function followFileTextIdentity(kind: EntityKind, text: string, nextId: string): Promise<string> {
  return invokeCommand('follow_text_identity', { payload: { kind, text, nextId } satisfies FollowTextIdentityPayload });
}
