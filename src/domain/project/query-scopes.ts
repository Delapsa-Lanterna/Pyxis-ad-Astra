import type { EntityKind, InvalidatedQueryScope } from '@/shared/types';

export function matchesEntityQueryScope(
  scope: InvalidatedQueryScope,
  queryKind: 'entity-detail' | 'entity-list',
  kind: EntityKind,
  id: string | null,
): boolean {
  return scope.kind === queryKind && (!scope.entity || (scope.entity.kind === kind && (!scope.entity.id || !id || scope.entity.id === id)));
}
