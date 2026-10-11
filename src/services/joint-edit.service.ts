import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryLive } from '@/services/query-cache.service';
import type { JointEditRoot, JointEditDraft, SaveJointEditPayload, JointEditWriteResult, QueryValue } from '@/shared/types';

export function queryJointEdit(root: JointEditRoot, signal?: AbortSignal): Promise<QueryValue<'joint-edit'>> {
  return queryLive(
    { sessionId: root.sessionId, queryKind: 'joint-edit', parameters: root },
    (captured) => invokeCommand('query_joint_edit', { payload: captured.parameters }),
    signal,
  );
}
export function prepareJointEdit(draft: JointEditDraft, signal?: AbortSignal): Promise<QueryValue<'joint-edit-prepare'>> {
  return queryLive(
    { sessionId: draft.baseline.root.sessionId, queryKind: 'joint-edit-prepare', parameters: draft },
    (captured) => invokeCommand('prepare_joint_edit', { payload: captured.parameters }),
    signal,
  );
}
export function saveJointEdit(payload: SaveJointEditPayload): Promise<JointEditWriteResult> {
  return invokeCommand('save_joint_edit', { payload });
}
