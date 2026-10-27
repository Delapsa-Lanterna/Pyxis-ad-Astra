import { matchesEntityQueryScope } from '@/domain/project/query-scopes';
import type {
  EntityData,
  EntityEditInfo,
  EntityIdentityIntent,
  QueryEntityPayload,
  QueryEntityListPayload,
  EntityIdentityIntentPayload,
  EntityKind,
  EntityEditTarget,
  DeepReadonly,
} from '@/shared/types';
import type { ProjectInvalidation } from '@/shared/types';

import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createCachedSessionQuery, createLiveSessionQuery } from '@/services/query-cache.service';

const readEntity = createCachedSessionQuery<Omit<QueryEntityPayload, 'sessionId'>, EntityData | null>({
  queryKind: 'entity-detail',
  load: ({ sessionId, parameters }) =>
    invokeCommand<EntityData | null>('query_entity', { payload: { sessionId, ...parameters } satisfies QueryEntityPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => matchesEntityQueryScope(scope, 'entity-detail', parameters.kind, parameters.id)),
});

const readEntityList = createCachedSessionQuery<Omit<QueryEntityListPayload, 'sessionId'>, EntityData[]>({
  queryKind: 'entity-list',
  load: ({ sessionId, parameters }) =>
    invokeCommand<EntityData[]>('query_entity_list', { payload: { sessionId, ...parameters } satisfies QueryEntityListPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => matchesEntityQueryScope(scope, 'entity-list', parameters.kind, null)),
});

const readEditTarget = createLiveSessionQuery<Omit<QueryEntityPayload, 'sessionId'>, EntityEditInfo>({
  queryKind: 'entity-edit-target',
  load: ({ sessionId, parameters }) =>
    invokeCommand<EntityEditInfo>('query_entity_edit_target', { payload: { sessionId, ...parameters } satisfies QueryEntityPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => matchesEntityQueryScope(scope, 'entity-detail', parameters.kind, parameters.id)),
});

const readIdentityIntent = createLiveSessionQuery<Omit<EntityIdentityIntentPayload, 'sessionId'>, EntityIdentityIntent>({
  queryKind: 'entity-identity-intent',
  load: ({ sessionId, parameters }) =>
    invokeCommand<EntityIdentityIntent>('query_entity_identity_intent', {
      payload: { sessionId, ...parameters } satisfies EntityIdentityIntentPayload,
    }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some(
      (scope) =>
        matchesEntityQueryScope(scope, 'entity-detail', parameters.source.kind, parameters.source.id) ||
        matchesEntityQueryScope(scope, 'entity-detail', parameters.source.kind, parameters.nextId),
    ),
});

export function querySessionEntity(
  sessionId: string,
  kind: EntityKind,
  id: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<EntityData | null>> {
  const parameters = { kind, id };
  return readEntity(sessionId, parameters, signal);
}

export function querySessionEntityList(sessionId: string, kind: EntityKind, signal?: AbortSignal): Promise<DeepReadonly<EntityData[]>> {
  return readEntityList(sessionId, { kind }, signal);
}

export function querySessionEntityEditTarget(
  sessionId: string,
  kind: EntityKind,
  id: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<EntityEditInfo>> {
  return readEditTarget(sessionId, { kind, id }, signal);
}

export function querySessionEntityIdentityIntent(
  sessionId: string,
  source: EntityEditTarget,
  nextId: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<EntityIdentityIntent>> {
  const parameters = { source, nextId };
  return readIdentityIntent(sessionId, parameters, signal);
}

export function hasEntityInvalidation(
  invalidation: ProjectInvalidation,
  queryKind: 'entity-detail' | 'entity-list',
  kind: EntityKind,
  id: string | null = null,
): boolean {
  return invalidation.session || invalidation.queryScopes.some((scope) => matchesEntityQueryScope(scope, queryKind, kind, id));
}
