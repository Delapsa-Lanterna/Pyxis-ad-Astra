import type {
  LoadEditableFilePayload,
  SaveTextFilePayload,
  TranscodeFilePayload,
  TextIdentityIntentPayload,
  FollowTextIdentityPayload,
} from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
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
): Promise<WriteResult> {
  return invokeCommand('save_text_file', { payload: { baseVersions, sessionId, modRoot, path, text } satisfies SaveTextFilePayload });
}

export function transcodeFileToUtf8(
  sessionId: string | null,
  modRoot: string,
  path: string,
  encoding: string,
  baseVersions: FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('transcode_file_to_utf8', {
    payload: { baseVersions, sessionId, modRoot, path, encoding } satisfies TranscodeFilePayload,
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
