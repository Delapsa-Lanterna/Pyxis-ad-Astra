import type { EntityEditTarget, EntityKind, FileVersion, ResourceRef } from './project-identity.types';
import type { JsonValue } from './json.types';
import type { JsonComposition } from './json-composition.types';
import type { JsonFileContent } from './file-content.types';

export interface EntityData {
  kind: EntityKind;
  id: string;
  target: EntityEditTarget;
  baseVersions: FileVersion[];
  document: JsonFileContent | null;
  data: JsonValue;
  composition: JsonComposition | null;
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
