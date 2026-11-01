import type {
  LoadEditableFilePayload,
  TextSave,
  TextTranscode,
  TextIdentityIntentPayload,
  FollowTextIdentityPayload,
  JsonWriteOptions,
  EntityEditTarget,
  EntityIdentityIntent,
  EntityKind,
} from '@/shared/types';
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
  jsonWrite?: JsonWriteOptions,
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

export function queryFileTextIdentityIntent(sessionId: string, source: EntityEditTarget, text: string): Promise<EntityIdentityIntent> {
  return invokeCommand('query_text_identity_intent', { payload: { sessionId, source, text } satisfies TextIdentityIntentPayload });
}

export function followFileTextIdentity(kind: EntityKind, text: string, nextId: string): Promise<string> {
  return invokeCommand('follow_text_identity', { payload: { kind, text, nextId } satisfies FollowTextIdentityPayload });
}
