import type { TextTranscode, FollowTextIdentityPayload, EntityKind, FileVersion, WriteResult } from '@/shared/types';
import { invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';

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
