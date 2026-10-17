import type {
  InvalidateProjectSessionPayload,
  RefreshProjectSourcesPayload,
  FileChangeRecord,
  ProjectSessionInvalidationResult,
  SynchronizeCommittedWritePayload,
  CommittedSessionUpdate,
} from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function synchronizeSessionCommit(sessionId: string, modRoot: string, commitId: number): Promise<CommittedSessionUpdate> {
  return invokeCommand('synchronize_committed_write', {
    payload: { sessionId, modRoot, commitId } satisfies SynchronizeCommittedWritePayload,
  });
}

export function requestProjectSessionRefresh(sessionId: string, changes: FileChangeRecord[]): Promise<ProjectSessionInvalidationResult> {
  return invokeCommand('invalidate_project_session', { payload: { sessionId, changes } satisfies InvalidateProjectSessionPayload });
}

export function refreshProjectSources(
  sessionId: string,
  sources: readonly import('@/shared/types').InvalidatedResourceScope[],
): Promise<ProjectSessionInvalidationResult> {
  return invokeCommand('refresh_project_sources', { payload: { sessionId, sources } satisfies RefreshProjectSourcesPayload });
}
