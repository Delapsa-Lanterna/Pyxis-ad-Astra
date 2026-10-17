import type {
  JointEditSnapshot,
  JointVariantCatalogRead,
  JointEditPrepared,
  JointEditQuery,
  JointEditRoot,
  JointEditDraft,
  SaveJointEditPayload,
  JointEditWriteResult,
  DeepReadonly,
  JointSourceCreate,
  JointVariantCatalogKind,
} from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createLiveSessionQuery, createCachedSessionQuery } from '@/services/query-cache.service';

const readJointEdit = createLiveSessionQuery<JointEditQuery, JointEditSnapshot>({
  queryKind: 'joint-edit',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => invalidation.paths.length > 0,
});

const readJointCandidate = createCachedSessionQuery<JointEditQuery, JointEditSnapshot>({
  queryKind: 'joint-edit-candidate',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => invalidation.paths.length > 0,
});

const readJointProjection = createLiveSessionQuery<JointEditQuery, JointEditSnapshot>({
  queryKind: 'joint-edit-projection',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => invalidation.paths.length > 0,
});

const readJointCatalog = createCachedSessionQuery<JointEditQuery, JointVariantCatalogRead>({
  queryKind: 'joint-edit-catalog',
  load: ({ parameters }) => invokeCommand<JointVariantCatalogRead>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => invalidation.paths.length > 0,
});

const readJointPreparation = createLiveSessionQuery<JointEditDraft, JointEditPrepared>({
  queryKind: 'joint-edit-prepare',
  load: ({ parameters }) => invokeCommand<JointEditPrepared>('prepare_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => invalidation.paths.length > 0,
});

export function queryJointEdit(
  root: JointEditRoot,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<DeepReadonly<JointEditSnapshot>> {
  return readJointEdit(root.sessionId, { root, rowKey: null, values: null, newSources: [...newSources], catalog: null }, signal);
}
export function queryJointCandidate(root: JointEditRoot, signal?: AbortSignal): Promise<DeepReadonly<JointEditSnapshot>> {
  const parameters = { root: { ...root }, rowKey: null, values: null, newSources: [], catalog: null };
  return readJointCandidate(root.sessionId, parameters, signal);
}
export function queryJointEditRow(
  root: Omit<JointEditRoot, 'id'>,
  rowKey: string,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<DeepReadonly<JointEditSnapshot>> {
  return readJointEdit(
    root.sessionId,
    { root: { ...root, id: '' }, rowKey, values: null, newSources: [...newSources], catalog: null },
    signal,
  );
}
export function queryJointEditProjection(draft: JointEditDraft, signal?: AbortSignal): Promise<DeepReadonly<JointEditSnapshot>> {
  return readJointProjection(
    draft.baseline.root.sessionId,
    { root: draft.baseline.root, rowKey: null, values: draft.values, newSources: draft.baseline.newSources, catalog: null },
    signal,
  );
}
export function queryJointVariantCatalog(
  root: JointEditRoot,
  catalog: JointVariantCatalogKind,
  signal?: AbortSignal,
): Promise<DeepReadonly<JointVariantCatalogRead>> {
  const parameters = { root: { ...root }, rowKey: null, values: null, newSources: [], catalog };
  return readJointCatalog(root.sessionId, parameters, signal);
}
export function prepareJointEdit(draft: JointEditDraft, signal?: AbortSignal): Promise<DeepReadonly<JointEditPrepared>> {
  return readJointPreparation(draft.baseline.root.sessionId, draft, signal);
}
export function saveJointEdit(payload: SaveJointEditPayload): Promise<JointEditWriteResult> {
  return invokeCommand('save_joint_edit', { payload });
}
