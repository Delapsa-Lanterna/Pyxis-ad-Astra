import type { EntityKind, ResourceRef } from '@/shared/types/project-identity.types';
import type { JsonValue } from '@/shared/types/json.types';

export interface EntityData {
  target: import('@/shared/types/project-identity.types').EntityEditTarget;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  kind: EntityKind;
  id: string;
  data: JsonValue;
  resourceRefs: Record<string, ResourceRef>;
}

export interface QueryEntityPayload {
  sessionId: string;
  kind: EntityKind;
  id: string;
}

export interface QueryEntityListPayload {
  sessionId: string;
  kind: EntityKind;
}
