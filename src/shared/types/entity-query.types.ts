import type { EntityKind, ResourceRef, EntityEditTarget, FileVersion } from '@/shared/types/project-identity.types';
import type { JsonValue } from '@/shared/types/json.types';
import type { JsonComposition } from './json-composition.types';

export interface EntityData {
  composition?: JsonComposition;
  target: EntityEditTarget;
  baseVersions: FileVersion[];
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
