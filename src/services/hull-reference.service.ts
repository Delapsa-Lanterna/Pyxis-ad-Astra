import type { HullReferencesResult, HullReferencesPayload, DeepReadonly, ProjectInvalidation } from '@/shared/types';

import { invokeCommand } from '@/shared/runtime/command.runtime';
import { CachedSessionQuery } from '@/services/query-cache.service';
import { hullReferenceOptions, hullWeaponSlotOptions, type HullSlotKind } from '@/domain/resources/hull-references';

export function hasHullReferencesInvalidation(invalidation: ProjectInvalidation) {
  return invalidation.session || invalidation.queryScopes.some((scope) => scope.kind === 'hull-references');
}

const readHullReferences = new CachedSessionQuery<Omit<HullReferencesPayload, 'sessionId'>, HullReferencesResult>({
  queryKind: 'hull-references',
  load: ({ sessionId, parameters }) =>
    invokeCommand<HullReferencesResult>('query_hull_references', { payload: { sessionId, ...parameters } satisfies HullReferencesPayload }),
  invalidates: (_parameters, invalidation) => hasHullReferencesInvalidation(invalidation),
});

export function querySessionHullReferences(
  sessionId: string,
  referenceIds: readonly string[],
  signal?: AbortSignal,
): Promise<DeepReadonly<HullReferencesResult>> {
  const parameters = { referenceIds: [...new Set(referenceIds)].sort() };
  return readHullReferences.read(sessionId, parameters, signal);
}

export async function queryHullReferenceOptions(sessionId: string, referenceIds: readonly string[], signal?: AbortSignal) {
  return hullReferenceOptions(await querySessionHullReferences(sessionId, referenceIds, signal));
}

export async function queryBuiltInWeaponSlotOptions(
  sessionId: string,
  hullId: string,
  signal?: AbortSignal,
  kind: HullSlotKind = 'builtInWeaponSlots',
) {
  return hullWeaponSlotOptions(await querySessionHullReferences(sessionId, [hullId], signal), hullId, kind);
}
