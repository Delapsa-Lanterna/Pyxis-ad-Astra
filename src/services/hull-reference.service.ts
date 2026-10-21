import type { HullReferencesResult, HullReferencesPayload, DeepReadonly } from '@/shared/types';

import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createCachedSessionQuery } from '@/services/query-cache.service';
import { measurePerformanceAsync } from '@/shared/runtime/performance';
import { hullReferenceOptions, builtInWeaponSlotOptions } from '@/domain/resources/hull-references';

const readHullReferences = createCachedSessionQuery<Omit<HullReferencesPayload, 'sessionId'>, HullReferencesResult>({
  queryKind: 'hull-references',
  load: ({ sessionId, parameters }) =>
    invokeCommand<HullReferencesResult>('query_hull_references', { payload: { sessionId, ...parameters } satisfies HullReferencesPayload }),
  invalidates: (_parameters, invalidation) => invalidation.queryScopes.some((scope) => scope.kind === 'hull-references'),
});

export function querySessionHullReferences(
  sessionId: string,
  referenceIds: readonly string[],
  signal?: AbortSignal,
): Promise<DeepReadonly<HullReferencesResult>> {
  const parameters = { referenceIds: [...new Set(referenceIds)].sort() };
  return readHullReferences(sessionId, parameters, signal);
}

export async function queryHullReferenceOptions(sessionId: string, referenceIds: readonly string[], signal?: AbortSignal) {
  return measurePerformanceAsync('frontend.config.hullReferenceCatalog', { references: referenceIds.length }, async () =>
    hullReferenceOptions(await querySessionHullReferences(sessionId, referenceIds, signal)),
  );
}

export async function queryBuiltInWeaponSlotOptions(sessionId: string, hullId: string, signal?: AbortSignal) {
  return builtInWeaponSlotOptions(await querySessionHullReferences(sessionId, [hullId], signal), hullId);
}
