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
  ResourceSource,
  ProjectInvalidation,
} from '@/shared/types';
import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { readLiveSessionQuery, type SessionQueryDefinition, CachedSessionQuery } from '@/services/query-cache.service';
import { captureSaveEdits } from '@/domain/project/save-edits';

export function hasJointEditInvalidation(invalidation: ProjectInvalidation) {
  return invalidation.session || invalidation.paths.length > 0;
}

const readJointEdit = {
  queryKind: 'joint-edit',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => hasJointEditInvalidation(invalidation),
} satisfies SessionQueryDefinition<JointEditQuery, JointEditSnapshot>;

const readJointCandidate = new CachedSessionQuery<JointEditQuery, JointEditSnapshot>({
  queryKind: 'joint-edit-candidate',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => hasJointEditInvalidation(invalidation),
});

const readJointProjection = {
  queryKind: 'joint-edit-projection',
  load: ({ parameters }) => invokeCommand<JointEditSnapshot>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => hasJointEditInvalidation(invalidation),
} satisfies SessionQueryDefinition<JointEditQuery, JointEditSnapshot>;

const readJointCatalog = new CachedSessionQuery<JointEditQuery, JointVariantCatalogRead>({
  queryKind: 'joint-edit-catalog',
  load: ({ parameters }) => invokeCommand<JointVariantCatalogRead>('query_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => hasJointEditInvalidation(invalidation),
});

const readJointPreparation = {
  queryKind: 'joint-edit-prepare',
  load: ({ parameters }) => invokeCommand<JointEditPrepared>('prepare_joint_edit', { payload: parameters }),
  invalidates: (_parameters, invalidation) => hasJointEditInvalidation(invalidation),
} satisfies SessionQueryDefinition<JointEditDraft, JointEditPrepared>;

export function queryJointEdit(
  root: JointEditRoot,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<DeepReadonly<JointEditSnapshot>> {
  return readLiveSessionQuery(
    readJointEdit,
    root.sessionId,
    { root, rowKey: null, values: null, newSources: [...newSources], catalog: null },
    signal,
  );
}
export function queryJointCandidate(root: JointEditRoot, signal?: AbortSignal): Promise<DeepReadonly<JointEditSnapshot>> {
  const parameters = { root: { ...root }, rowKey: null, values: null, newSources: [], catalog: null };
  return readJointCandidate.read(root.sessionId, parameters, signal);
}
export function queryJointEditRow(
  root: Omit<JointEditRoot, 'id'>,
  rowKey: string,
  signal?: AbortSignal,
  newSources: readonly JointSourceCreate[] = [],
): Promise<DeepReadonly<JointEditSnapshot>> {
  return readLiveSessionQuery(
    readJointEdit,
    root.sessionId,
    { root: { ...root, id: '' }, rowKey, values: null, newSources: [...newSources], catalog: null },
    signal,
  );
}
export function queryJointEditProjection(draft: JointEditDraft, signal?: AbortSignal): Promise<DeepReadonly<JointEditSnapshot>> {
  return readLiveSessionQuery(
    readJointProjection,
    draft.baseline.root.sessionId,
    { root: draft.baseline.root, rowKey: null, values: draft.values, newSources: draft.baseline.newSources, catalog: null },
    signal,
  );
}
export function queryJointVariantCatalog(
  root: JointEditRoot,
  catalog: JointVariantCatalogKind,
  signal?: AbortSignal,
  catalogSource?: ResourceSource,
): Promise<DeepReadonly<JointVariantCatalogRead>> {
  const parameters = {
    root: { ...root },
    rowKey: null,
    values: null,
    newSources: [],
    catalog,
    ...(catalogSource ? { catalogSource } : {}),
  };
  return readJointCatalog.read(root.sessionId, parameters, signal);
}
export function prepareJointEdit(draft: JointEditDraft, signal?: AbortSignal): Promise<DeepReadonly<JointEditPrepared>> {
  return readLiveSessionQuery(readJointPreparation, draft.baseline.root.sessionId, draft, signal);
}
export function saveJointEdit(payload: SaveJointEditPayload, request?: SaveCommandRequest): Promise<JointEditWriteResult> {
  const original = Object.fromEntries(
    payload.snapshot.records.filter((record) => Object.hasOwn(payload.values, record.key)).map((record) => [record.key, record.value]),
  );
  return invokeSaveCommand('save_joint_edit', { payload }, captureSaveEdits(original, payload.values), request);
}
