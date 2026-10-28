import type { FileHistoryPayload, FileReplay } from '@/shared/types';
import { invokeCommand, invokeSaveCommand } from '@/shared/runtime/command.runtime';
import type { FileChangeReplayDirection, FileHistorySnapshot } from '@/shared/types';

export function loadFileHistory(sessionId: string, modRoot: string): Promise<FileHistorySnapshot> {
  return invokeCommand('query_file_history', { payload: { sessionId, modRoot } satisfies FileHistoryPayload });
}

export function clearSavedFileHistory(sessionId: string, modRoot: string): Promise<FileHistorySnapshot> {
  return invokeCommand('clear_file_history', { payload: { sessionId, modRoot } satisfies FileHistoryPayload });
}

export function replayFileChangeSet(
  sessionId: string,
  modRoot: string,
  direction: FileChangeReplayDirection,
  entryId: number,
  revision: number,
): Promise<import('@/shared/types').WriteResult> {
  return invokeSaveCommand('apply_file_change_set', {
    payload: { sessionId, modRoot, direction, entryId, revision } satisfies FileReplay,
  });
}
