import type {
  LoadEditableFilePayload,
  TextSave,
  TextTranscode,
  TextIdentityIntentPayload,
  FollowTextIdentityPayload,
} from '@/shared/types';
import { invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';
import type { EditableFileData, FileVersion, WriteResult } from '@/shared/types';

export function loadEditableFileData(sessionId: string | null, modRoot: string, path: string): Promise<EditableFileData> {
  return invokeCommand('load_editable_file', { payload: { sessionId, modRoot, path } satisfies LoadEditableFilePayload });
}

export function writeEditableFileText(
  sessionId: string | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: import('@/shared/types').FileVersion[],
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
  jsonWrite?: import('@/shared/types').JsonWriteOptions,
): Promise<WriteResult> {
  return invokeSaveCommand(
    'save_text_file',
    { payload: { baseVersions, sessionId, modRoot, path, text, ...(jsonWrite ? { jsonWrite } : {}) } satisfies TextSave },
    [],
    request,
  );
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

export function queryFileTextIdentityIntent(
  sessionId: string,
  source: import('@/shared/types').EntityEditTarget,
  text: string,
): Promise<import('@/shared/types').EntityIdentityIntent> {
  return invokeCommand('query_text_identity_intent', { payload: { sessionId, source, text } satisfies TextIdentityIntentPayload });
}

export function followFileTextIdentity(kind: import('@/shared/types').EntityKind, text: string, nextId: string): Promise<string> {
  return invokeCommand('follow_text_identity', { payload: { kind, text, nextId } satisfies FollowTextIdentityPayload });
}
