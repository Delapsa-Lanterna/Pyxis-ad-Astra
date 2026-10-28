import { matchesEntityQueryScope } from '@/domain/project/query-scopes';
import type {
  ResourceRef,
  ResolveModRelativePathPayload,
  DraftResourcesPayload,
  DraftResourceEntityKind,
  RowData,
  DeepReadonly,
} from '@/shared/types';

import { invokeCommand } from '@/shared/runtime/command.runtime';
import { readLiveSessionQuery, type SessionQueryDefinition } from '@/services/query-cache.service';

const readResourceReference = {
  queryKind: 'resource-reference',
  load: ({ sessionId, parameters }) =>
    invokeCommand<string>('resolve_mod_relative_path', { payload: { sessionId, ...parameters } satisfies ResolveModRelativePathPayload }),
  invalidates: () => false,
} satisfies SessionQueryDefinition<Omit<ResolveModRelativePathPayload, 'sessionId'>, string>;

const readDraftResources = {
  queryKind: 'draft-resources',
  load: ({ sessionId, parameters }) =>
    invokeCommand<Record<string, ResourceRef>>('query_draft_resources', {
      payload: { sessionId, ...parameters } satisfies DraftResourcesPayload,
    }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => matchesEntityQueryScope(scope, 'entity-detail', parameters.kind, parameters.id)),
} satisfies SessionQueryDefinition<Omit<DraftResourcesPayload, 'sessionId'>, Record<string, ResourceRef>>;

export function resolveModImageReference(sessionId: string, modRoot: string, absolutePath: string, signal?: AbortSignal): Promise<string> {
  return readLiveSessionQuery(readResourceReference, sessionId, { modRoot, absolutePath }, signal);
}

export function querySessionDraftResources(
  sessionId: string,
  kind: DraftResourceEntityKind,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<DeepReadonly<Record<string, ResourceRef>>> {
  const parameters = { kind, id, draft };
  return readLiveSessionQuery(readDraftResources, sessionId, parameters, signal);
}
