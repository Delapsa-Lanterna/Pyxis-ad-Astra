import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryLive, queryCached } from '@/services/query-cache.service';
import type {
  JointEditRoot,
  JointEditDraft,
  SaveJointEditPayload,
  JointEditWriteResult,
  QueryValue,
  JointSourceCreate,
  JointVariantCatalogKind,
} from '@/shared/types';

export function queryJointEdit(
  root: JointEditRoot,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<QueryValue<'joint-edit'>> {
  return queryLive(
    {
      sessionId: root.sessionId,
      queryKind: 'joint-edit',
      parameters: { root, rowKey: null, values: null, newSources: [...newSources], catalog: null },
    },
    (captured) => invokeCommand('query_joint_edit', { payload: captured.parameters }),
    signal,
  );
}
export function queryJointCandidate(root: JointEditRoot, signal?: AbortSignal): Promise<QueryValue<'joint-edit-candidate'>> {
  const parameters = { root: { ...root }, rowKey: null, values: null, newSources: [], catalog: null };
  return queryCached(
    { sessionId: root.sessionId, queryKind: 'joint-edit-candidate', parameters },
    () => invokeCommand('query_joint_edit', { payload: parameters }),
    signal,
  );
}
export function queryJointEditRow(
  root: Omit<JointEditRoot, 'id'>,
  rowKey: string,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<QueryValue<'joint-edit'>> {
  return queryLive(
    {
      sessionId: root.sessionId,
      queryKind: 'joint-edit',
      parameters: { root: { ...root, id: '' }, rowKey, values: null, newSources: [...newSources], catalog: null },
    },
    (captured) => invokeCommand('query_joint_edit', { payload: captured.parameters }),
    signal,
  );
}
export function queryJointEditProjection(draft: JointEditDraft, signal?: AbortSignal): Promise<QueryValue<'joint-edit-projection'>> {
  return queryLive(
    {
      sessionId: draft.baseline.root.sessionId,
      queryKind: 'joint-edit-projection',
      parameters: { root: draft.baseline.root, rowKey: null, values: draft.values, newSources: draft.baseline.newSources, catalog: null },
    },
    (captured) => invokeCommand('query_joint_edit', { payload: captured.parameters }),
    signal,
  );
}
export function queryJointVariantCatalog(
  root: JointEditRoot,
  catalog: JointVariantCatalogKind,
  signal?: AbortSignal,
): Promise<QueryValue<'joint-edit-catalog'>> {
  const parameters = { root: { ...root }, rowKey: null, values: null, newSources: [], catalog };
  return queryCached(
    { sessionId: root.sessionId, queryKind: 'joint-edit-catalog', parameters },
    () => invokeCommand('query_joint_edit', { payload: parameters }),
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
