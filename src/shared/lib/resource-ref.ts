import { RESOURCE_OWNER_KINDS, RESOURCE_SOURCES, type ResourceRef } from '@/shared/types';
import { normalizeFsPath } from './paths';

const resourceSources = new Set<string>(RESOURCE_SOURCES);
const resourceOwnerKinds = new Set<string>(RESOURCE_OWNER_KINDS);
export function isExternalSource(source: ResourceRef['source'] | undefined): boolean {
  return source === 'core' || source === 'reference';
}

export function isResourceRef(value: unknown): value is ResourceRef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ResourceRef>;
  return (
    typeof candidate.source === 'string' &&
    resourceSources.has(candidate.source) &&
    typeof candidate.relPath === 'string' &&
    typeof candidate.ownerKind === 'string' &&
    resourceOwnerKinds.has(candidate.ownerKind) &&
    typeof candidate.ownerId === 'string' &&
    typeof candidate.key === 'string'
  );
}

export function sameResourceRef(left: ResourceRef, right: ResourceRef): boolean {
  return (
    left.source === right.source &&
    left.reference?.sessionId === right.reference?.sessionId &&
    normalizeFsPath(left.reference?.modRoot ?? '') === normalizeFsPath(right.reference?.modRoot ?? '') &&
    normalizeFsPath(left.relPath) === normalizeFsPath(right.relPath) &&
    left.ownerKind === right.ownerKind &&
    left.ownerId === right.ownerId &&
    left.key === right.key
  );
}
